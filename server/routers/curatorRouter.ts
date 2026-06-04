import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { curatedPosts, discoveredArticles } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const curatorRouter = router({
  listByStatus: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "pending_review", "approved", "scheduled", "published", "failed"]),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result = await db.select()
        .from(curatedPosts)
        .where(eq(curatedPosts.id, input.postId))
        .limit(1);

      return result[0] || null;
    }),

  curateArticle: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const article = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.id, input.articleId))
        .limit(1);

      if (!article.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      }

      await db.insert(curatedPosts).values({
        articleId: input.articleId,
        platform: "x",
        content: "AI-generated content pending review",
        status: "pending_review",
      });

      return { success: true, message: "Article curated successfully" };
    }),

  approvePosts: protectedProcedure
    .input(z.object({
      postIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(curatedPosts)
        .set({
          ...(input.content && { content: input.content }),
          ...(input.status && { status: input.status }),
        })
        .where(eq(curatedPosts.id, input.postId));

      return { success: true };
    }),
});
