import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { curatedPosts, discoveredArticles } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/** Character budget per platform for generated post copy. */
const PLATFORM_LIMITS: Record<string, number> = {
  x: 280, twitter: 280, linkedin: 3000, facebook: 2000, instagram: 2200, youtube: 1000,
};

/**
 * Generate a real, platform-appropriate social post from an article using the
 * AI provider. Falls back to a simple template only if the model is
 * unavailable, so curation always yields usable content (never a placeholder).
 */
async function generatePostDraft(
  aiProvider: { chat: (args: any) => Promise<string> },
  article: { title: string | null; content: string | null; summary: string | null },
  platform: string,
): Promise<string> {
  const limit = PLATFORM_LIMITS[platform.toLowerCase()] ?? 280;
  const prompt = `You are a social media content curator. Generate a concise, engaging ${platform} post (max ${limit} characters) based on the following article. Output only the post text, no preamble.

Article Title: ${article.title || "Untitled"}
Content: ${(article.content || article.summary || "").slice(0, 1500)}`;

  try {
    const draft = await aiProvider.chat({
      providerId: "anthropic",
      modelId: "claude-opus-4-1",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 400,
    });
    return draft.trim().slice(0, limit);
  } catch {
    return `Check out: "${article.title || "New article"}" - ${(article.summary || article.content || "").slice(0, 80).trim()}...`;
  }
}

export const curatorRouter = router({
  listByStatus: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "pending_review", "approved", "scheduled", "published", "failed"]),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();

      const posts = await db.select()
        .from(curatedPosts)
        .where(eq(curatedPosts.status, input.status))
        .limit(input.limit)
        .offset(input.offset);

      return posts;
    }),
  getPost: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();

      const result = await db.select()
        .from(curatedPosts)
        .where(eq(curatedPosts.id, input.postId))
        .limit(1);

      return result[0] || null;
    }),
  curateArticle: protectedProcedure
    .input(z.object({ articleId: z.number(), platform: z.string().default("x") }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      const article = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.id, input.articleId))
        .limit(1);

      if (!article.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      }

      // Actually generate the post copy with AI (was a hardcoded placeholder).
      const content = await generatePostDraft(ctx.services.aiProvider, article[0], input.platform);

      await db.insert(curatedPosts).values({
        articleId: input.articleId,
        platform: input.platform,
        content,
        status: "pending_review",
      });

      // Mark the source article as processed so it isn't re-curated.
      await db.update(discoveredArticles)
        .set({ isProcessed: 1 })
        .where(eq(discoveredArticles.id, input.articleId));

      return { success: true, message: "Article curated successfully" };
    }),
  approvePosts: protectedProcedure
    .input(z.object({
      postIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();

      for (const postId of input.postIds) {
        await db.update(curatedPosts)
          .set({ status: "approved" })
          .where(eq(curatedPosts.id, postId));
      }

      return { success: true, approvedCount: input.postIds.length };
    }),
  rejectPosts: protectedProcedure
    .input(z.object({
      postIds: z.array(z.number()),
      rejectionReason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();

      for (const postId of input.postIds) {
        await db.update(curatedPosts)
          .set({
            status: "failed",
            approvalNotes: input.rejectionReason || "Rejected by user",
          })
          .where(eq(curatedPosts.id, postId));
      }

      return { success: true, rejectedCount: input.postIds.length };
    }),
  updatePost: protectedProcedure
    .input(z.object({
      postId: z.number(),
      content: z.string().optional(),
      status: z.enum(["draft", "pending_review", "approved", "scheduled", "published", "failed"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();

      await db.update(curatedPosts)
        .set({
          ...(input.content && { content: input.content }),
          ...(input.status && { status: input.status }),
        })
        .where(eq(curatedPosts.id, input.postId));

      return { success: true };
    }),
  regenerateDraft: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      const article = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.id, input.articleId))
        .limit(1);

      if (!article.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      }

      const draft = await generatePostDraft(ctx.services.aiProvider, article[0], "x");
      return { success: true, draft };
    }),
});
