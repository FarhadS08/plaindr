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

        // Generate AI title
        const newTitle = await generateConversationTitle(messageList);

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

    // Filter conversations by tag
    filterByTag: protectedProcedure
      .input(z.object({
        tagId: z.string().uuid().optional(),
      }))
      .query(async ({ ctx, input }) => {
        if (!input.tagId) {
          // Return all conversations if no tag filter
          const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .eq('user_id', ctx.user.id)
            .order('updated_at', { ascending: false });

          if (error) throw new Error(error.message);
          return data || [];
        }

        // Get conversation IDs that have this tag
        const { data: taggedConvs, error: tagError } = await supabase
          .from('conversation_tags')
          .select('conversation_id')
          .eq('tag_id', input.tagId);

        if (tagError) throw new Error(tagError.message);

        const conversationIds = (taggedConvs || []).map((ct: any) => ct.conversation_id);

        if (conversationIds.length === 0) {
          return [];
        }

        // Get the conversations
        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('user_id', ctx.user.id)
          .in('id', conversationIds)
          .order('updated_at', { ascending: false });

        if (error) throw new Error(error.message);
        return data || [];
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

  // Tags routes - for organizing conversations
  tags: router({
    // Get all tags for the current user
    list: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('name', { ascending: true });

      if (error) throw new Error(error.message);
      return data || [];
    }),

    // Create a new tag
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(50),
        color: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase
          .from('tags')
          .insert({
            user_id: ctx.user.id,
            name: input.name.trim(),
            color: input.color || 'blue',
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            throw new Error('Tag with this name already exists');
          }
          throw new Error(error.message);
        }
        return data;
      }),

    // Update a tag
    update: protectedProcedure
      .input(z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(50).optional(),
        color: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const updateData: Record<string, string> = {};
        if (input.name) updateData.name = input.name.trim();
        if (input.color) updateData.color = input.color;

        const { error } = await supabase
          .from('tags')
          .update(updateData)
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Delete a tag
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // Delete tag associations first
        await supabase
          .from('conversation_tags')
          .delete()
          .eq('tag_id', input.id);

        // Delete the tag
        const { error } = await supabase
          .from('tags')
          .delete()
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Get tags for a specific conversation
    getForConversation: protectedProcedure
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

        // Get tags for this conversation
        const { data, error } = await supabase
          .from('conversation_tags')
          .select('tag_id, tags(*)')
          .eq('conversation_id', input.conversationId);

        if (error) throw new Error(error.message);
        return (data || []).map((ct: any) => ct.tags).filter(Boolean);
      }),

    // Add tag to conversation
    addToConversation: protectedProcedure
      .input(z.object({
        conversationId: z.string().uuid(),
        tagId: z.string().uuid(),
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

        // Verify tag belongs to user
        const { data: tag, error: tagError } = await supabase
          .from('tags')
          .select('id')
          .eq('id', input.tagId)
          .eq('user_id', ctx.user.id)
          .single();

        if (tagError || !tag) {
          throw new Error('Tag not found');
        }

        // Add the association
        const { error } = await supabase
          .from('conversation_tags')
          .insert({
            conversation_id: input.conversationId,
            tag_id: input.tagId,
          });

        if (error) {
          if (error.code === '23505') {
            // Already exists, that's fine
            return { success: true };
          }
          throw new Error(error.message);
        }
        return { success: true };
      }),

    // Remove tag from conversation
    removeFromConversation: protectedProcedure
      .input(z.object({
        conversationId: z.string().uuid(),
        tagId: z.string().uuid(),
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

        const { error } = await supabase
          .from('conversation_tags')
          .delete()
          .eq('conversation_id', input.conversationId)
          .eq('tag_id', input.tagId);

        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Bulk add tag to multiple conversations
    bulkAddToConversations: protectedProcedure
      .input(z.object({
        conversationIds: z.array(z.string().uuid()),
        tagId: z.string().uuid(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify tag belongs to user
        const { data: tag, error: tagError } = await supabase
          .from('tags')
          .select('id')
          .eq('id', input.tagId)
          .eq('user_id', ctx.user.id)
          .single();

        if (tagError || !tag) {
          throw new Error('Tag not found');
        }

        // Verify all conversations belong to user
        const { data: convs, error: convsError } = await supabase
          .from('conversations')
          .select('id')
          .eq('user_id', ctx.user.id)
          .in('id', input.conversationIds);

        if (convsError) throw new Error(convsError.message);

        const validConvIds = (convs || []).map((c: any) => c.id);

        if (validConvIds.length === 0) {
          return { success: true, added: 0 };
        }

        // Insert associations (ignore duplicates)
        const insertData = validConvIds.map((convId: string) => ({
          conversation_id: convId,
          tag_id: input.tagId,
        }));

        const { error } = await supabase
          .from('conversation_tags')
          .upsert(insertData, { onConflict: 'conversation_id,tag_id', ignoreDuplicates: true });

        if (error) throw new Error(error.message);
        return { success: true, added: validConvIds.length };
      }),

    // Bulk remove tag from multiple conversations
    bulkRemoveFromConversations: protectedProcedure
      .input(z.object({
        conversationIds: z.array(z.string().uuid()),
        tagId: z.string().uuid(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify all conversations belong to user
        const { data: convs, error: convsError } = await supabase
          .from('conversations')
          .select('id')
          .eq('user_id', ctx.user.id)
          .in('id', input.conversationIds);

        if (convsError) throw new Error(convsError.message);

        const validConvIds = (convs || []).map((c: any) => c.id);

        if (validConvIds.length === 0) {
          return { success: true, removed: 0 };
        }

        // Delete associations
        const { error } = await supabase
          .from('conversation_tags')
          .delete()
          .eq('tag_id', input.tagId)
          .in('conversation_id', validConvIds);

        if (error) throw new Error(error.message);
        return { success: true, removed: validConvIds.length };
      }),
  }),
});

export type AppRouter = typeof appRouter;
