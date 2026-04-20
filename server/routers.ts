import type { SupabaseClient } from "@supabase/supabase-js";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { generateConversationTitle, hasEnoughContextForTitle } from "./titleGeneration";

// Per-request Supabase clients now come from ctx.supabase — built in
// the protectedProcedure middleware, they impersonate the authed
// Clerk user so RLS policies evaluate correctly without needing the
// service role key. See server/_core/supabase.ts for the JWT signing.

/**
 * Upsert the caller's active-organization pointer. Used during org
 * creation, explicit switching, and after leave() so the UI doesn't
 * end up pointing at an org the user no longer belongs to.
 * Creates a minimal user_profiles row on the fly if none exists yet.
 *
 * Takes an explicit Supabase client (the per-request user-scoped one
 * from ctx.supabase) so callers inside tRPC procedures run under
 * their own RLS context.
 */
async function setActiveForUser(
  sb: SupabaseClient,
  userId: string,
  organizationId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await sb
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        active_organization_id: organizationId,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(error.message);
}

export const appRouter = router({
  // Auth routes - using Clerk, no server-side session management needed
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // Logout is handled by Clerk on the frontend
  }),

  // Conversation routes - using Supabase directly
  conversations: router({
    // Create a new conversation. If organization_id is provided, the
    // conversation is shared with that org (members can read). Null
    // (or omitted) keeps it personal. RLS enforces membership.
    create: protectedProcedure
      .input(z.object({
        title: z.string().optional(),
        organization_id: z.string().uuid().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await ctx.supabase
          .from('conversations')
          .insert({
            user_id: ctx.user.id,
            title: input.title || 'New Conversation',
            organization_id: input.organization_id ?? null,
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        return data;
      }),

    // List conversations in the given scope. Personal (null) returns
    // only the caller's private threads; an org id returns threads
    // shared to that org (RLS verifies membership).
    list: protectedProcedure
      .input(
        z.object({ organization_id: z.string().uuid().nullable() })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const orgId = input?.organization_id ?? null;
        let query = ctx.supabase
          .from('conversations')
          .select('*')
          .order('updated_at', { ascending: false });

        if (orgId) {
          query = query.eq('organization_id', orgId);
        } else {
          query = query.eq('user_id', ctx.user.id).is('organization_id', null);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data || [];
      }),

    // Get a specific conversation with messages. RLS enforces that
    // the caller can only read their own threads or those shared to
    // an org they belong to.
    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { data: conversation, error: convError } = await ctx.supabase
          .from('conversations')
          .select('*')
          .eq('id', input.id)
          .maybeSingle();

        if (convError || !conversation) {
          throw new Error('Conversation not found');
        }

        // Get messages
        const { data: messages, error: msgError } = await ctx.supabase
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
        const { error } = await ctx.supabase
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
        const { data: conversation, error: convError } = await ctx.supabase
          .from('conversations')
          .select('*')
          .eq('id', input.id)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conversation) {
          throw new Error('Conversation not found');
        }

        // Get messages for context
        const { data: messages, error: msgError } = await ctx.supabase
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
        const { error: updateError } = await ctx.supabase
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
          const { data, error } = await ctx.supabase
            .from('conversations')
            .select('*')
            .eq('user_id', ctx.user.id)
            .order('updated_at', { ascending: false });

          if (error) throw new Error(error.message);
          return data || [];
        }

        // Search by title using ilike for case-insensitive matching
        const { data, error } = await ctx.supabase
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
        await ctx.supabase
          .from('messages')
          .delete()
          .eq('conversation_id', input.id);

        // Delete conversation
        const { error } = await ctx.supabase
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
          const { data, error } = await ctx.supabase
            .from('conversations')
            .select('*')
            .eq('user_id', ctx.user.id)
            .order('updated_at', { ascending: false });

          if (error) throw new Error(error.message);
          return data || [];
        }

        // Get conversation IDs that have this tag
        const { data: taggedConvs, error: tagError } = await ctx.supabase
          .from('conversation_tags')
          .select('conversation_id')
          .eq('tag_id', input.tagId);

        if (tagError) throw new Error(tagError.message);

        const conversationIds = (taggedConvs || []).map((ct: any) => ct.conversation_id);

        if (conversationIds.length === 0) {
          return [];
        }

        // Get the conversations
        const { data, error } = await ctx.supabase
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
    // Add a message to a conversation. Assistant messages are created
    // empty and then filled in by `messages.update` once the stream
    // completes — so this mutation never writes `sources`.
    add: protectedProcedure
      .input(z.object({
        conversationId: z.string().uuid(),
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data: conv, error: convError } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        const { data, error } = await ctx.supabase
          .from('messages')
          .insert({
            conversation_id: input.conversationId,
            role: input.role,
            content: input.content,
          })
          .select()
          .single();

        if (error) {
          console.error('[messages.add] insert failed', { error, role: input.role });
          throw new Error(error.message);
        }

        await ctx.supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', input.conversationId);

        return data;
      }),

    // Update a message's content + sources. Called once per assistant
    // answer, when the SSE stream finishes.
    update: protectedProcedure
      .input(z.object({
        id: z.string().uuid(),
        content: z.string(),
        sources: z.array(z.object({
          text: z.string(),
          source_url: z.string(),
          section_heading: z.string().nullable().optional(),
          policy_summary: z.string().nullable().optional(),
          relevance_score: z.number(),
          company_name: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify the message belongs to a conversation owned by the user.
        const { data: existing, error: fetchError } = await ctx.supabase
          .from('messages')
          .select('id, conversation_id')
          .eq('id', input.id)
          .single();

        if (fetchError || !existing) throw new Error('Message not found');

        const { data: conv, error: convError } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', existing.conversation_id)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) throw new Error('Conversation not found');

        const patch: Record<string, unknown> = { content: input.content };
        if (input.sources !== undefined) patch.sources = input.sources;

        let { error } = await ctx.supabase
          .from('messages')
          .update(patch)
          .eq('id', input.id);

        // If the `sources` column doesn't exist yet (migration 002 not
        // applied), retry with only the content so the answer still saves.
        const mentionsSources = (e: { code?: string; message?: string } | null) =>
          !!e && (
            e.code === '42703' ||
            e.code === 'PGRST204' ||
            (typeof e.message === 'string' && /sources/i.test(e.message))
          );
        if (error && mentionsSources(error) && 'sources' in patch) {
          const retry = await ctx.supabase
            .from('messages')
            .update({ content: input.content })
            .eq('id', input.id);
          error = retry.error;
        }

        if (error) {
          console.error('[messages.update] failed', error);
          throw new Error(error.message);
        }

        await ctx.supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', existing.conversation_id);

        return { success: true };
      }),

    // Delete a single message. Used to remove an empty assistant shell
    // when a stream aborts before any tokens arrive.
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { data: existing } = await ctx.supabase
          .from('messages')
          .select('id, conversation_id')
          .eq('id', input.id)
          .single();
        if (!existing) return { success: true };

        const { data: conv } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', existing.conversation_id)
          .eq('user_id', ctx.user.id)
          .single();
        if (!conv) throw new Error('Conversation not found');

        const { error } = await ctx.supabase
          .from('messages')
          .delete()
          .eq('id', input.id);
        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Get messages for a conversation
    list: protectedProcedure
      .input(z.object({ conversationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        // Verify conversation belongs to user
        const { data: conv, error: convError } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        const { data, error } = await ctx.supabase
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
      const { data, error } = await ctx.supabase
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
        const { data, error } = await ctx.supabase
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

        const { error } = await ctx.supabase
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
        await ctx.supabase
          .from('conversation_tags')
          .delete()
          .eq('tag_id', input.id);

        // Delete the tag
        const { error } = await ctx.supabase
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
        const { data: conv, error: convError } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        // Get tags for this conversation
        const { data, error } = await ctx.supabase
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
        const { data: conv, error: convError } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        // Verify tag belongs to user
        const { data: tag, error: tagError } = await ctx.supabase
          .from('tags')
          .select('id')
          .eq('id', input.tagId)
          .eq('user_id', ctx.user.id)
          .single();

        if (tagError || !tag) {
          throw new Error('Tag not found');
        }

        // Add the association
        const { error } = await ctx.supabase
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
        const { data: conv, error: convError } = await ctx.supabase
          .from('conversations')
          .select('id')
          .eq('id', input.conversationId)
          .eq('user_id', ctx.user.id)
          .single();

        if (convError || !conv) {
          throw new Error('Conversation not found');
        }

        const { error } = await ctx.supabase
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
        const { data: tag, error: tagError } = await ctx.supabase
          .from('tags')
          .select('id')
          .eq('id', input.tagId)
          .eq('user_id', ctx.user.id)
          .single();

        if (tagError || !tag) {
          throw new Error('Tag not found');
        }

        // Verify all conversations belong to user
        const { data: convs, error: convsError } = await ctx.supabase
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

        const { error } = await ctx.supabase
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
        const { data: convs, error: convsError } = await ctx.supabase
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
        const { error } = await ctx.supabase
          .from('conversation_tags')
          .delete()
          .eq('tag_id', input.tagId)
          .in('conversation_id', validConvIds);

        if (error) throw new Error(error.message);
        return { success: true, removed: validConvIds.length };
      }),
  }),

  // Profile routes - user profile management
  profiles: (() => {
    // Shared org-profile enums + schema, used by both upsert and
    // update so the two inputs can't drift.
    const INDUSTRIES = [
      'technology', 'healthcare', 'finance', 'legal', 'education',
      'pharmaceutical', 'retail', 'media', 'government', 'nonprofit',
      'consulting', 'manufacturing', 'other',
    ] as const;
    const ORG_SIZES = [
      '1', '2-10', '11-50', '51-200', '201-1000', '1001+',
    ] as const;
    const COMPLIANCE = [
      'GDPR', 'CCPA', 'HIPAA', 'SOC 2', 'ISO 27001', 'PCI DSS',
      'FERPA', 'FedRAMP', 'SOX', 'NIS2', 'DORA',
    ] as const;
    const DATA_RESIDENCY = ['any', 'EU', 'US', 'UK', 'other'] as const;

    const profileInput = z.object({
      display_name: z.string().min(1).max(100).optional(),
      usage_intent: z.enum([
        'personal_awareness',
        'professional_research',
        'compliance_checks',
        'curiosity',
        'other',
      ]).optional(),
      usage_intent_note: z.string().max(500).optional(),
      language: z.string().max(10).optional(),
      region: z.string().max(100).optional(),
      notifications_enabled: z.boolean().optional(),
      // Organization / compliance fields.
      organization_name: z.string().max(200).optional(),
      industry: z.enum(INDUSTRIES).optional(),
      organization_size: z.enum(ORG_SIZES).optional(),
      compliance_requirements: z.array(z.enum(COMPLIANCE)).max(20).optional(),
      data_residency: z.enum(DATA_RESIDENCY).optional(),
      organization_notes: z.string().max(2000).optional(),
    });

    return router({
    // Get the current user's profile
    get: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', ctx.user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned, which is fine for new users
        throw new Error(error.message);
      }

      return data;
    }),

    // Create or update the user's profile
    upsert: protectedProcedure
      .input(profileInput)
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString();

        // Check if profile exists
        const { data: existing } = await ctx.supabase
          .from('user_profiles')
          .select('id')
          .eq('user_id', ctx.user.id)
          .single();

        if (existing) {
          // Update existing profile
          const { data, error } = await ctx.supabase
            .from('user_profiles')
            .update({
              ...input,
              updated_at: now,
            })
            .eq('user_id', ctx.user.id)
            .select()
            .single();

          if (error) throw new Error(error.message);
          return data;
        } else {
          // Create new profile
          const { data, error } = await ctx.supabase
            .from('user_profiles')
            .insert({
              user_id: ctx.user.id,
              display_name: input.display_name || null,
              usage_intent: input.usage_intent || null,
              usage_intent_note: input.usage_intent_note || null,
              language: input.language || 'en',
              region: input.region || null,
              notifications_enabled: input.notifications_enabled ?? true,
              organization_name: input.organization_name || null,
              industry: input.industry || null,
              organization_size: input.organization_size || null,
              compliance_requirements: input.compliance_requirements ?? [],
              data_residency: input.data_residency || null,
              organization_notes: input.organization_notes || null,
              created_at: now,
              updated_at: now,
            })
            .select()
            .single();

          if (error) throw new Error(error.message);
          return data;
        }
      }),

    // Update specific profile fields — only touches keys that are
    // explicitly set in the input (undefined means "don't change").
    update: protectedProcedure
      .input(profileInput)
      .mutation(async ({ ctx, input }) => {
        const updateData: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) updateData[key] = value;
        }

        const { data, error } = await ctx.supabase
          .from('user_profiles')
          .update(updateData)
          .eq('user_id', ctx.user.id)
          .select()
          .single();

        if (error) throw new Error(error.message);
        return data;
      }),
    });
  })(),

  // Organizations — Wave 1.
  // Users create orgs, become owners, and flip a per-user "active
  // organization" pointer. All org-scoped data (conversations,
  // watchlists, notes) will read ctx.organizationId from the active
  // org once subsequent waves wire them up. For now this is strictly
  // plumbing: no existing data is affected, and users who never
  // create an org keep working exactly as before.
  organizations: router({
    // Every org the caller belongs to, with their role.
    list: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from('organization_members')
        .select('role, joined_at, organization:organizations (id, name, slug, created_at)')
        .eq('user_id', ctx.user.id)
        .order('joined_at', { ascending: true });

      if (error) throw new Error(error.message);
      // Flatten the join so the client gets a simple list.
      return (data ?? []).map(row => ({
        id: (row.organization as any)?.id as string,
        name: (row.organization as any)?.name as string,
        slug: (row.organization as any)?.slug as string,
        role: row.role as 'owner' | 'admin' | 'member',
        joined_at: row.joined_at as string,
        created_at: (row.organization as any)?.created_at as string,
      })).filter(o => o.id);
    }),

    // The currently-selected org for the caller (or null = personal).
    // Resolves through user_profiles.active_organization_id. Returns
    // null — never throws — so it's safe to call on first load before
    // the user has any profile row.
    getActive: protectedProcedure.query(async ({ ctx }) => {
      const { data: profile } = await ctx.supabase
        .from('user_profiles')
        .select('active_organization_id')
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      const activeId = profile?.active_organization_id as string | null;
      if (!activeId) return null;

      // Verify membership still holds (org could have been deleted or
      // the user removed since the pointer was set).
      const { data: org } = await ctx.supabase
        .from('organizations')
        .select('id, name, slug')
        .eq('id', activeId)
        .maybeSingle();
      if (!org) return null;

      const { data: membership } = await ctx.supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', activeId)
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      if (!membership) return null;

      return {
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
        role: membership.role as 'owner' | 'admin' | 'member',
      };
    }),

    // Create org + owner membership + set active pointer. Three
    // writes, not transactional (ctx.supabase client can't do xact), so
    // we manually roll back the org row if a follow-up write fails.
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100),
        slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, {
          message: 'Slug must use lowercase letters, digits, and dashes only',
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        // Reserved slugs we don't want people grabbing — these will
        // be meaningful URL segments once org namespaces exist.
        const RESERVED = new Set([
          'api', 'app', 'auth', 'admin', 'dashboard', 'invite',
          'login', 'logout', 'settings', 'billing', 'help',
          'docs', 'pricing', 'profile', 'signin', 'signup', 'plaindr',
        ]);
        if (RESERVED.has(input.slug)) {
          throw new Error('That slug is reserved — pick another');
        }

        // Bootstrap via SECURITY DEFINER RPC: creates the org row
        // and the owner membership in one transaction, reading the
        // caller from auth.uid(). Sidesteps the chicken-and-egg where
        // the org-visibility policy (`is_org_member`) would block the
        // returning-row SELECT right after a fresh insert.
        const { data: org, error: orgError } = await ctx.supabase
          .rpc('create_organization', {
            p_name: input.name.trim(),
            p_slug: input.slug,
          })
          .single<{ id: string; name: string; slug: string }>();

        if (orgError || !org) {
          if (orgError?.code === '23505') {
            throw new Error('An organization with that slug already exists');
          }
          throw new Error(orgError?.message ?? 'Failed to create organization');
        }

        // Make the new org the caller's active context.
        await setActiveForUser(ctx.supabase, ctx.user.id, org.id);

        return {
          id: org.id as string,
          name: org.name as string,
          slug: org.slug as string,
          role: 'owner' as const,
        };
      }),

    // Flip the caller's active org. Passing null switches back to
    // personal mode. Membership is verified so users can't set an
    // active org they don't belong to.
    setActive: protectedProcedure
      .input(z.object({ organization_id: z.string().uuid().nullable() }))
      .mutation(async ({ ctx, input }) => {
        if (input.organization_id) {
          const { data: membership, error } = await ctx.supabase
            .from('organization_members')
            .select('role')
            .eq('organization_id', input.organization_id)
            .eq('user_id', ctx.user.id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!membership) {
            throw new Error('You are not a member of that organization');
          }
        }
        await setActiveForUser(ctx.supabase, ctx.user.id, input.organization_id);
        return { active_organization_id: input.organization_id };
      }),

    // Leave an org. Blocks the last owner from leaving — otherwise
    // the org is orphaned and no one can invite / manage members.
    leave: protectedProcedure
      .input(z.object({ organization_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { data: self } = await ctx.supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', input.organization_id)
          .eq('user_id', ctx.user.id)
          .maybeSingle();
        if (!self) throw new Error('Not a member');

        if (self.role === 'owner') {
          const { data: owners, error: ownersError } = await ctx.supabase
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', input.organization_id)
            .eq('role', 'owner');
          if (ownersError) throw new Error(ownersError.message);
          if ((owners?.length ?? 0) <= 1) {
            throw new Error(
              "You're the last owner — transfer ownership before leaving",
            );
          }
        }

        const { error } = await ctx.supabase
          .from('organization_members')
          .delete()
          .eq('organization_id', input.organization_id)
          .eq('user_id', ctx.user.id);
        if (error) throw new Error(error.message);

        // If the org they left was their active context, reset to
        // personal so subsequent queries don't hit a dead FK.
        const { data: profile } = await ctx.supabase
          .from('user_profiles')
          .select('active_organization_id')
          .eq('user_id', ctx.user.id)
          .maybeSingle();
        if (profile?.active_organization_id === input.organization_id) {
          await setActiveForUser(ctx.supabase, ctx.user.id, null);
        }
        return { success: true };
      }),

    // Everyone in the org, joined with profile info for rendering.
    // Membership in the org is enforced via RLS on organization_members.
    members: protectedProcedure
      .input(z.object({ organization_id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { data, error } = await ctx.supabase
          .from('organization_members')
          .select('user_id, role, joined_at')
          .eq('organization_id', input.organization_id)
          .order('joined_at', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map(m => ({
          user_id: m.user_id as string,
          role: m.role as 'owner' | 'admin' | 'member',
          joined_at: m.joined_at as string,
          is_self: m.user_id === ctx.user.id,
        }));
      }),

    // Promote/demote. Owners can change anyone (including handing
    // ownership to someone else); admins can only move member ↔ admin.
    // Blocks demoting the last owner.
    updateMemberRole: protectedProcedure
      .input(z.object({
        organization_id: z.string().uuid(),
        user_id: z.string(),
        role: z.enum(['owner', 'admin', 'member']),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data: self } = await ctx.supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', input.organization_id)
          .eq('user_id', ctx.user.id)
          .maybeSingle();
        if (!self) throw new Error('Not a member of that organization');

        const { data: target } = await ctx.supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', input.organization_id)
          .eq('user_id', input.user_id)
          .maybeSingle();
        if (!target) throw new Error('That user is not in the organization');

        if (self.role !== 'owner') {
          if (self.role !== 'admin') throw new Error('Admins only');
          if (input.role === 'owner' || target.role === 'owner') {
            throw new Error('Only an owner can grant or revoke ownership');
          }
        }

        if (target.role === 'owner' && input.role !== 'owner') {
          const { data: owners } = await ctx.supabase
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', input.organization_id)
            .eq('role', 'owner');
          if ((owners?.length ?? 0) <= 1) {
            throw new Error(
              "Can't demote the last owner — promote someone else first",
            );
          }
        }

        const { error } = await ctx.supabase
          .from('organization_members')
          .update({ role: input.role })
          .eq('organization_id', input.organization_id)
          .eq('user_id', input.user_id);
        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Kick a member. Admins can remove members; owners can remove
    // anyone. Never removes the last owner.
    removeMember: protectedProcedure
      .input(z.object({
        organization_id: z.string().uuid(),
        user_id: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.user_id === ctx.user.id) {
          throw new Error('Use "leave" to remove yourself');
        }

        const { data: self } = await ctx.supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', input.organization_id)
          .eq('user_id', ctx.user.id)
          .maybeSingle();
        if (!self || (self.role !== 'admin' && self.role !== 'owner')) {
          throw new Error('Admins only');
        }

        const { data: target } = await ctx.supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', input.organization_id)
          .eq('user_id', input.user_id)
          .maybeSingle();
        if (!target) throw new Error('That user is not in the organization');

        if (target.role === 'owner') {
          throw new Error('Owners can only leave, not be removed');
        }
        if (self.role === 'admin' && target.role === 'admin') {
          throw new Error('Only an owner can remove another admin');
        }

        const { error } = await ctx.supabase
          .from('organization_members')
          .delete()
          .eq('organization_id', input.organization_id)
          .eq('user_id', input.user_id);
        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Admin-only rename. Slug is immutable (would break invite URLs).
    rename: protectedProcedure
      .input(z.object({
        organization_id: z.string().uuid(),
        name: z.string().min(1).max(100),
      }))
      .mutation(async ({ ctx, input }) => {
        const { error } = await ctx.supabase
          .from('organizations')
          .update({ name: input.name.trim(), updated_at: new Date().toISOString() })
          .eq('id', input.organization_id);
        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Owner-only delete. Cascades through memberships (FK on delete
    // cascade in 005) and nulls out active_organization_id pointers
    // (FK on delete set null).
    delete: protectedProcedure
      .input(z.object({ organization_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { data: self } = await ctx.supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', input.organization_id)
          .eq('user_id', ctx.user.id)
          .maybeSingle();
        if (!self || self.role !== 'owner') {
          throw new Error('Only an owner can delete the organization');
        }

        const { error } = await ctx.supabase
          .from('organizations')
          .delete()
          .eq('id', input.organization_id);
        if (error) throw new Error(error.message);
        return { success: true };
      }),
  }),

  // Invites to join an org. Admins create + manage; anyone with a
  // code can peek at the target org; accepting is via SECURITY DEFINER
  // RPC so we can validate email + membership in one transaction.
  invites: router({
    list: protectedProcedure
      .input(z.object({ organization_id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { data, error } = await ctx.supabase
          .from('org_invites')
          .select('id, code, email, role, created_at, expires_at, accepted_at')
          .eq('organization_id', input.organization_id)
          .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data ?? [];
      }),

    // Admin creates an invite. Email is optional — if omitted we
    // issue a link that any signed-in user with the code can redeem.
    create: protectedProcedure
      .input(z.object({
        organization_id: z.string().uuid(),
        email: z.string().email().nullable().optional(),
        role: z.enum(['admin', 'member']).default('member'),
      }))
      .mutation(async ({ ctx, input }) => {
        // URL-safe code: compact and hard to guess.
        const code = crypto.randomUUID().replace(/-/g, '');
        const { data, error } = await ctx.supabase
          .from('org_invites')
          .insert({
            organization_id: input.organization_id,
            code,
            email: input.email ?? null,
            role: input.role,
            invited_by: ctx.user.id,
          })
          .select('id, code, email, role, expires_at')
          .single();
        if (error) throw new Error(error.message);
        return data;
      }),

    // Admin revokes. Simple hard delete — preserves audit cleanliness
    // at the cost of historical "who invited whom"; we can add a
    // revoked_at column later if that history matters.
    revoke: protectedProcedure
      .input(z.object({ invite_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { error } = await ctx.supabase
          .from('org_invites')
          .delete()
          .eq('id', input.invite_id);
        if (error) throw new Error(error.message);
        return { success: true };
      }),

    // Preview an invite by code for the /invite/:code page. Uses a
    // SECURITY DEFINER RPC so the code alone is enough — we don't
    // need a public read policy on org_invites.
    peek: publicProcedure
      .input(z.object({ code: z.string().min(1) }))
      .query(async ({ input }) => {
        // peek_invite is safe for anon; we use anonSupabase so this
        // works even before the user has signed in.
        const { anonSupabase } = await import('./_core/supabase');
        const { data, error } = await anonSupabase.rpc('peek_invite', {
          p_code: input.code,
        });
        if (error) throw new Error(error.message);
        return data as {
          found: boolean;
          organization_name?: string;
          organization_slug?: string;
          role?: 'admin' | 'member';
          email?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          email_matches?: boolean;
        };
      }),

    // Authenticated user redeems the code. Server-side RPC validates
    // email match + expiry + double-accept, then joins the org.
    accept: protectedProcedure
      .input(z.object({ code: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await ctx.supabase.rpc('accept_invite', {
          p_code: input.code,
        });
        if (error) throw new Error(error.message);
        const payload = data as { organization_id: string; role: string };
        // Make the freshly-joined org the user's active context.
        await setActiveForUser(ctx.supabase, ctx.user.id, payload.organization_id);
        return payload;
      }),
  }),

  // Personal company watchlist — one row per (user, company).
  // Keeps the Overview's CompanyWatchlist widget simple: no JSONB
  // arrays, no ordering drama, just list/add/remove.
  watchlist: router({
    // List entries in the given scope. Personal (null) returns only
    // the caller's private entries; an org id returns entries tagged
    // with that org (RLS enforces membership).
    list: protectedProcedure
      .input(
        z.object({ organization_id: z.string().uuid().nullable() })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const orgId = input?.organization_id ?? null;
        let query = ctx.supabase
          .from('watchlist_entries')
          .select('company_id, added_at, organization_id')
          .order('added_at', { ascending: false });

        if (orgId) {
          query = query.eq('organization_id', orgId);
        } else {
          query = query.eq('user_id', ctx.user.id).is('organization_id', null);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data || [];
      }),

    add: protectedProcedure
      .input(z.object({
        company_id: z.string().uuid(),
        organization_id: z.string().uuid().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Manual upsert — the unique index in migration 009 includes
        // organization_id, so (user, null, company) and (user, org,
        // company) are distinct rows. We pre-check to avoid a 23505
        // when the same scope already has the entry.
        const orgId = input.organization_id ?? null;
        const existing = await ctx.supabase
          .from('watchlist_entries')
          .select('id')
          .eq('user_id', ctx.user.id)
          .eq('company_id', input.company_id)
          .is('organization_id', orgId === null ? null : null)
          .maybeSingle();

        if (!orgId && existing.data) {
          // Personal dup — just refresh added_at.
          const { data, error } = await ctx.supabase
            .from('watchlist_entries')
            .update({ added_at: new Date().toISOString() })
            .eq('id', existing.data.id)
            .select()
            .single();
          if (error) throw new Error(error.message);
          return data;
        }

        const { data, error } = await ctx.supabase
          .from('watchlist_entries')
          .insert({
            user_id: ctx.user.id,
            company_id: input.company_id,
            organization_id: orgId,
            added_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        return data;
      }),

    remove: protectedProcedure
      .input(z.object({
        company_id: z.string().uuid(),
        organization_id: z.string().uuid().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const orgId = input.organization_id ?? null;
        let query = ctx.supabase
          .from('watchlist_entries')
          .delete()
          .eq('user_id', ctx.user.id)
          .eq('company_id', input.company_id);
        query = orgId
          ? query.eq('organization_id', orgId)
          : query.is('organization_id', null);

        const { error } = await query;
        if (error) throw new Error(error.message);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
