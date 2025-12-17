import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { 
  createConversation, 
  getConversationsByUser, 
  getConversationById, 
  addMessage, 
  getMessagesByConversation,
  updateConversationTitle,
  deleteConversation
} from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Conversation routes
  conversations: router({
    // Create a new conversation
    create: protectedProcedure
      .input(z.object({
        supabaseId: z.string(),
        title: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await createConversation({
          supabaseId: input.supabaseId,
          userId: ctx.user.id,
          title: input.title || null,
        });
      }),

    // Get all conversations for the current user
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getConversationsByUser(ctx.user.id);
    }),

    // Get a specific conversation with messages
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const conversation = await getConversationById(input.id);
        if (!conversation || conversation.userId !== ctx.user.id) {
          throw new Error('Conversation not found');
        }
        const messages = await getMessagesByConversation(input.id);
        return { conversation, messages };
      }),

    // Update conversation title
    updateTitle: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const conversation = await getConversationById(input.id);
        if (!conversation || conversation.userId !== ctx.user.id) {
          throw new Error('Conversation not found');
        }
        await updateConversationTitle(input.id, input.title);
        return { success: true };
      }),

    // Delete a conversation
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const conversation = await getConversationById(input.id);
        if (!conversation || conversation.userId !== ctx.user.id) {
          throw new Error('Conversation not found');
        }
        await deleteConversation(input.id);
        return { success: true };
      }),
  }),

  // Message routes
  messages: router({
    // Add a message to a conversation
    add: protectedProcedure
      .input(z.object({
        conversationId: z.number(),
        role: z.enum(['user', 'assistant']),
        content: z.string(),
        audioUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const conversation = await getConversationById(input.conversationId);
        if (!conversation || conversation.userId !== ctx.user.id) {
          throw new Error('Conversation not found');
        }
        return await addMessage({
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          audioUrl: input.audioUrl || null,
        });
      }),

    // Get messages for a conversation
    list: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ ctx, input }) => {
        const conversation = await getConversationById(input.conversationId);
        if (!conversation || conversation.userId !== ctx.user.id) {
          throw new Error('Conversation not found');
        }
        return await getMessagesByConversation(input.conversationId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
