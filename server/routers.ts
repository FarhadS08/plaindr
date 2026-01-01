import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { generateConversationTitle, hasEnoughContextForTitle } from "./titleGeneration";

// Initialize Supabase client for server-side operations
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export const appRouter = router({
  // Auth routes - using Clerk, no server-side session management needed
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // Logout is handled by Clerk on the frontend
  }),

  // Conversation routes - using Supabase directly
  conversations: router({
    // Create a new conversation
    create: protectedProcedure
      .input(z.object({
        title: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase
          .from('conversations')
          .insert({
            user_id: ctx.user.id, // Clerk user ID (string)
            title: input.title || 'New Conversation',
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        return data;
      }),

    // Get all conversations for the current user
    list: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('updated_at', { ascending: false });

      if (error) throw new Error(error.message);
      return data || [];
    }),

    // Get a specific conversation with messages
    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // Get conversation
        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', input.id)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conversation) {
          throw new Error('Conversation not found');
        }

        // Get messages
        const { data: messages, error: msgError } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', input.id)
          .order('created_at', { ascending: true });

        if (msgError) throw new Error(msgError.message);

        return { conversation, messages: messages || [] };
      }),

    // Update conversation title
    updateTitle: protectedProcedure
      .input(z.object({
        id: z.string().uuid(),
        title: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { error } = await supabase
          .from('conversations')
          .update({ title: input.title, updated_at: new Date().toISOString() })
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Generate AI title for a conversation
    generateTitle: protectedProcedure
      .input(z.object({
        id: z.string().uuid(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Get conversation to verify ownership
        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', input.id)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conversation) {
          throw new Error('Conversation not found');
        }

        // Get messages for context
        const { data: messages, error: msgError } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', input.id)
          .order('created_at', { ascending: true });

        if (msgError) throw new Error(msgError.message);

        const messageList = messages || [];

        // Check if we have enough context
        if (!hasEnoughContextForTitle(messageList)) {
          return { 
            success: false, 
            title: conversation.title,
            reason: 'Not enough conversation context yet'
          };
        }

        // Generate AI title, passing current title to ensure we get a different one
        const newTitle = await generateConversationTitle(messageList, conversation.title);

        // Update the conversation with the new title
        const { error: updateError } = await supabase
          .from('conversations')
          .update({ title: newTitle, updated_at: new Date().toISOString() })
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (updateError) throw new Error(updateError.message);

        return { success: true, title: newTitle };
      }),

    // Search conversations by title
    search: protectedProcedure
      .input(z.object({
        query: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const searchQuery = input.query.trim().toLowerCase();
        
        if (!searchQuery) {
          // Return all conversations if no search query
          const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .eq('user_id', ctx.user.id)
            .order('updated_at', { ascending: false });

          if (error) throw new Error(error.message);
          return data || [];
        }

        // Search by title using ilike for case-insensitive matching
        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('user_id', ctx.user.id)
          .ilike('title', `%${searchQuery}%`)
          .order('updated_at', { ascending: false });

        if (error) throw new Error(error.message);
        return data || [];
      }),

    // Delete a conversation
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // Delete messages first
        await supabase
          .from('messages')
          .delete()
          .eq('conversation_id', input.id);

        // Delete conversation
        const { error } = await supabase
          .from('conversations')
          .delete()
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (error) throw new Error(error.message);
        return { success: true };
      }),
  }),

  // Message routes - using Supabase directly
  messages: router({
    // Add a message to a conversation
    add: protectedProcedure
      .input(z.object({
        conversationId: z.string().uuid(),
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify conversation belongs to user
        const { data: conv, error: convError } = await supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        // Add message
        const { data, error } = await supabase
          .from('messages')
          .insert({
            conversation_id: input.conversationId,
            role: input.role,
            content: input.content,
          })
          .select()
          .single();

        if (error) throw new Error(error.message);

        // Update conversation timestamp
        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', input.conversationId);

        return data;
      }),

    // Get messages for a conversation
    list: protectedProcedure
      .input(z.object({ conversationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // Verify conversation belongs to user
        const { data: conv, error: convError } = await supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', input.conversationId)
          .order('created_at', { ascending: true });

        if (error) throw new Error(error.message);
        return data || [];
      }),
  }),
});

export type AppRouter = typeof appRouter;
