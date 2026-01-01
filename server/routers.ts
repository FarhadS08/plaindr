import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { generateConversationTitle, hasEnoughContextForTitle } from "./titleGeneration";
import { suggestTagsForConversation, findMatchingExistingTag } from "./tagSuggestion";

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

  // Tag routes for organizing conversations
  tags: router({
    // Create a new tag
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(50),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase
          .from('tags')
          .insert({
            user_id: ctx.user.id,
            name: input.name.trim(),
            color: input.color || '#8B5CF6',
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            throw new Error('A tag with this name already exists');
          }
          throw new Error(error.message);
        }
        return data;
      }),

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

    // Update a tag
    update: protectedProcedure
      .input(z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(50).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const updateData: { name?: string; color?: string; updated_at: string } = {
          updated_at: new Date().toISOString(),
        };
        if (input.name) updateData.name = input.name.trim();
        if (input.color) updateData.color = input.color;

        const { error } = await supabase
          .from('tags')
          .update(updateData)
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (error) {
          if (error.code === '23505') {
            throw new Error('A tag with this name already exists');
          }
          throw new Error(error.message);
        }
        return { success: true };
      }),

    // Delete a tag
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { error } = await supabase
          .from('tags')
          .delete()
          .eq('id', input.id)
          .eq('user_id', ctx.user.id);

        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Add a tag to a conversation
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

        // Add the tag to the conversation
        const { error } = await supabase
          .from('conversation_tags')
          .insert({
            conversation_id: input.conversationId,
            tag_id: input.tagId,
          });

        if (error) {
          if (error.code === '23505') {
            // Tag already assigned, not an error
            return { success: true, alreadyExists: true };
          }
          throw new Error(error.message);
        }
        return { success: true, alreadyExists: false };
      }),

    // Remove a tag from a conversation
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

        const { data, error } = await supabase
          .from('conversation_tags')
          .select('tag_id, tags(id, name, color)')
          .eq('conversation_id', input.conversationId);

        if (error) throw new Error(error.message);
        
        // Extract tag data from the joined result
        return (data || []).map(item => item.tags).filter(Boolean);
      }),

    // Get conversations by tag
    getConversationsByTag: protectedProcedure
      .input(z.object({ tagId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
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

        const { data, error } = await supabase
          .from('conversation_tags')
          .select('conversation_id, conversations(*)')
          .eq('tag_id', input.tagId);

        if (error) throw new Error(error.message);
        
        // Extract conversation data from the joined result
        return (data || []).map(item => item.conversations).filter(Boolean);
      }),

    // Suggest tags for a conversation based on its content
    suggestForConversation: protectedProcedure
      .input(z.object({ conversationId: z.string().uuid() }))
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

        // Get messages for the conversation
        const { data: messages, error: msgError } = await supabase
          .from('messages')
          .select('role, content')
          .eq('conversation_id', input.conversationId)
          .order('created_at', { ascending: true });

        if (msgError) throw new Error(msgError.message);
        if (!messages || messages.length === 0) {
          return { suggestions: [], success: false, error: 'No messages in conversation' };
        }

        // Get user's existing tags
        const { data: existingTags, error: tagsError } = await supabase
          .from('tags')
          .select('id, name, color')
          .eq('user_id', ctx.user.id);

        if (tagsError) throw new Error(tagsError.message);

        // Get suggestions from LLM
        const result = await suggestTagsForConversation(
          messages.map(m => ({ role: m.role, content: m.content })),
          existingTags || []
        );

        // Enhance suggestions with existing tag info
        const enhancedSuggestions = result.suggestions.map(suggestion => {
          const existingTag = findMatchingExistingTag(suggestion.name, existingTags || []);
          return {
            ...suggestion,
            existingTagId: existingTag?.id || null,
            existingTagColor: existingTag?.color || null,
            isNew: !existingTag
          };
        });

        return {
          suggestions: enhancedSuggestions,
          success: result.success,
          error: result.error
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
