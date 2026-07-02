/**
 * publishExecutor — turns scheduled rows into real published posts.
 *
 * Shared by schedulingRouter.publishNow (manual) and the publish worker
 * (due-time automation). For each scheduled post it loads the content + the
 * connected platform account token, calls PublishingService, and writes the
 * real outcome back to scheduledPosts (published/failed + platformPostId or
 * errorMessage). Refreshed tokens are persisted to platformAccounts.
 */
import { getDb } from "../../db.factory.js";
import { scheduledPosts, curatedPosts, platformAccounts, users } from "../../../drizzle/schema.js";
import { eq, inArray, and, lte } from "drizzle-orm";
import { PublishingService, RateLimitError, type PublishAccount } from "./PublishingService.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("publishExecutor");

export interface PublishOutcome {
  scheduledPostId: number;
  ok: boolean;
  platformPostId?: string;
  url?: string;
  error?: string;
  /** True when the post was rate-limited and auto-rescheduled (not a hard failure). */
  rateLimited?: boolean;
  /** ISO time the post was rescheduled to, when rateLimited. */
  retryAt?: string;
}

/** Extract media URLs from a curatedPosts.metadata blob, if present. */
function mediaUrlsFrom(metadata: unknown): string[] | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const m = metadata as Record<string, unknown>;
  const urls = m.mediaUrls ?? m.media ?? m.images;
  if (Array.isArray(urls)) return urls.filter((u): u is string => typeof u === "string");
  return undefined;
}

async function publishOne(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  row: {
    id: number;
    platformAccountId: number;
    content: string | null;
    metadata: unknown;
  },
): Promise<PublishOutcome> {
  const accounts = await db
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.id, row.platformAccountId))
    .limit(1);
  const account = accounts[0];

  if (!account) {
    const error = "Connected platform account not found";
    await db.update(scheduledPosts).set({ status: "failed", errorMessage: error }).where(eq(scheduledPosts.id, row.id));
    return { scheduledPostId: row.id, ok: false, error };
  }
  if (!row.content) {
    const error = "Post has no content";
    await db.update(scheduledPosts).set({ status: "failed", errorMessage: error }).where(eq(scheduledPosts.id, row.id));
    return { scheduledPostId: row.id, ok: false, error };
  }

  const pubAccount: PublishAccount = {
    id: account.id,
    platform: account.platform,
    oauthToken: account.oauthToken,
    oauthRefreshToken: account.oauthRefreshToken,
    accountMetadata: account.accountMetadata,
  };

  // Resolve the account owner's execution mode so the webhook publisher can
  // fail closed on non-local n8n egress when the user is sovereign (air-gapped).
  const owner = await db
    .select({ executionMode: users.executionMode })
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);
  const sovereign = owner[0]?.executionMode === "sovereign";

  try {
    const result = await PublishingService.getInstance().publish(pubAccount, {
      content: row.content,
      mediaUrls: mediaUrlsFrom(row.metadata),
      sovereign,
    });

    // Persist a refreshed token if one was issued during publish.
    if (result.refreshedToken) {
      await db
        .update(platformAccounts)
        .set({
          oauthToken: result.refreshedToken.accessToken,
          ...(result.refreshedToken.refreshToken ? { oauthRefreshToken: result.refreshedToken.refreshToken } : {}),
          ...(result.refreshedToken.expiresInSec
            ? { tokenExpiresAt: new Date(Date.now() + result.refreshedToken.expiresInSec * 1000) }
            : {}),
        })
        .where(eq(platformAccounts.id, account.id));
    }

    await db
      .update(scheduledPosts)
      .set({ status: "published", publishedAt: new Date(), platformPostId: result.platformPostId, errorMessage: null })
      .where(eq(scheduledPosts.id, row.id));

    log.info(`Published scheduled post ${row.id} to ${account.platform}`, { url: result.url });
    return { scheduledPostId: row.id, ok: true, platformPostId: result.platformPostId, url: result.url };
  } catch (err) {
    // Rate limit → reschedule (don't burn the post). The publish worker
    // (publishDuePosts) will retry it once the reset window passes; true
    // quota/permission problems surface as other 4xx → the failed path below.
    if (err instanceof RateLimitError) {
      const retryAt = new Date(Date.now() + err.retryAfterSec * 1000);
      await db
        .update(scheduledPosts)
        .set({
          status: "scheduled",
          scheduledAt: retryAt,
          errorMessage: `Rate limited by ${err.platform}; auto-retry at ${retryAt.toISOString()}`,
        })
        .where(eq(scheduledPosts.id, row.id));
      log.warn(`Rate limited publishing post ${row.id} to ${account.platform} — rescheduled for ${retryAt.toISOString()}`);
      return { scheduledPostId: row.id, ok: false, rateLimited: true, retryAt: retryAt.toISOString(), error: err.message };
    }

    const error = err instanceof Error ? err.message : String(err);
    await db.update(scheduledPosts).set({ status: "failed", errorMessage: error.slice(0, 1000) }).where(eq(scheduledPosts.id, row.id));
    log.warn(`Failed to publish scheduled post ${row.id} to ${account.platform}`, error);
    return { scheduledPostId: row.id, ok: false, error };
  }
}

/** Publish a specific set of scheduled posts (manual "Publish now"). */
export async function publishScheduledPostIds(ids: number[]): Promise<PublishOutcome[]> {
  const db = await getDb();
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: scheduledPosts.id,
      platformAccountId: scheduledPosts.platformAccountId,
      content: curatedPosts.content,
      metadata: curatedPosts.metadata,
    })
    .from(scheduledPosts)
    .leftJoin(curatedPosts, eq(curatedPosts.id, scheduledPosts.curatedPostId))
    .where(inArray(scheduledPosts.id, ids));

  const outcomes: PublishOutcome[] = [];
  for (const row of rows) outcomes.push(await publishOne(db, row));
  return outcomes;
}

/** Publish every scheduled post whose time has arrived (worker tick). */
export async function publishDuePosts(): Promise<PublishOutcome[]> {
  const db = await getDb();

  const rows = await db
    .select({
      id: scheduledPosts.id,
      platformAccountId: scheduledPosts.platformAccountId,
      content: curatedPosts.content,
      metadata: curatedPosts.metadata,
    })
    .from(scheduledPosts)
    .leftJoin(curatedPosts, eq(curatedPosts.id, scheduledPosts.curatedPostId))
    .where(and(eq(scheduledPosts.status, "scheduled"), lte(scheduledPosts.scheduledAt, new Date())));

  const outcomes: PublishOutcome[] = [];
  for (const row of rows) outcomes.push(await publishOne(db, row));
  if (outcomes.length > 0) log.info(`Publish worker processed ${outcomes.length} due post(s)`);
  return outcomes;
}
