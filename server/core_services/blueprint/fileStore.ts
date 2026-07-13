/**
 * Blueprint Studio — plan-file persistence with revision lineage.
 *
 * Shared by the agent toolset (compile_cad / patterns / FEA) and the router
 * (geometry import). Writing a file whose (planId, kind, name) already exists
 * supersedes the prior file rather than piling up: the old row loses `isLatest`,
 * the new row bumps `version` and points back via `supersedesId`. Drawings, the
 * 3D viewer and the PDF read only the latest; older versions stay downloadable.
 */
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.factory.js";
import { blueprintFiles } from "../../../drizzle/schema.js";
import { BlueprintCadService } from "./BlueprintCadService.js";

export async function persistPlanFile(
  planId: string,
  kind: (typeof blueprintFiles.$inferInsert)["kind"],
  name: string,
  data: Buffer | string,
  mimeType: string,
  meta?: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  const cad = BlueprintCadService.getInstance();
  const { filePath, sizeBytes } = await cad.saveArtifact(planId, name, data);
  const db = await getDb();
  const [prior] = await db
    .select()
    .from(blueprintFiles)
    .where(and(eq(blueprintFiles.planId, planId), eq(blueprintFiles.kind, kind), eq(blueprintFiles.name, name), eq(blueprintFiles.isLatest, true)))
    .limit(1);
  const id = uuidv4();
  const values = {
    id,
    planId,
    kind,
    name,
    path: filePath,
    mimeType,
    sizeBytes,
    meta,
    version: (prior?.version ?? 0) + 1,
    supersedesId: prior?.id,
    isLatest: true,
  };
  // Clearing the old `isLatest` and inserting the new latest are committed
  // atomically via `db.batch`, so a crash can never leave a part with no latest
  // file. (Interactive `db.transaction` can't be used here — the in-memory
  // libSQL used in tests opens a schemaless DB for it.) The read → write window
  // is safe under the current sequential agent tool loop; a genuinely
  // concurrent writer of the same (kind, name) is not reachable today.
  if (prior) {
    await db.batch([
      db.update(blueprintFiles).set({ isLatest: false }).where(eq(blueprintFiles.id, prior.id)),
      db.insert(blueprintFiles).values(values),
    ]);
  } else {
    await db.insert(blueprintFiles).values(values);
  }
  return { id, name };
}
