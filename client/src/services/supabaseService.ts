import { supabase } from '@/lib/supabase';

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// Create a new conversation
export async function createConversation(userId: string, title: string): Promise<Conversation | null> {
  console.log('[Supabase] Creating conversation for user:', userId, 'with title:', title);
  
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: title || 'New Conversation',
    })
    .select()
    .single();

  if (error) {
    console.error('[Supabase] Error creating conversation:', error.message, error.details, error.hint);
    return null;
  }

  console.log('[Supabase] Conversation created successfully:', data);
  return data;
}

// Get all conversations for a user
export async function getConversations(userId: string): Promise<Conversation[]> {
  console.log('[Supabase] Fetching conversations for user:', userId);
  
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[Supabase] Error fetching conversations:', error.message, error.details, error.hint);
    return [];
  }

  console.log('[Supabase] Fetched', data?.length || 0, 'conversations');
  return data || [];
}

// Get a single conversation with messages
export async function getConversationWithMessages(conversationId: string): Promise<{ conversation: Conversation; messages: Message[] } | null> {
  console.log('[Supabase] Fetching conversation with messages:', conversationId);
  
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (convError) {
    console.error('[Supabase] Error fetching conversation:', convError.message, convError.details, convError.hint);
    return null;
  }

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('[Supabase] Error fetching messages:', msgError.message, msgError.details, msgError.hint);
    return null;
  }

  console.log('[Supabase] Fetched conversation with', messages?.length || 0, 'messages');
  return { conversation, messages: messages || [] };
}

// Add a message to a conversation
export async function addMessage(conversationId: string, role: 'user' | 'assistant', content: string): Promise<Message | null> {
  console.log('[Supabase] Adding message to conversation:', conversationId, 'role:', role, 'content length:', content.length);
  
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error('[Supabase] Error adding message:', error.message, error.details, error.hint);
    return null;
  }

  console.log('[Supabase] Message added successfully:', data?.id);

  // Update conversation's updated_at timestamp
  const { error: updateError } = await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (updateError) {
    console.error('[Supabase] Error updating conversation timestamp:', updateError.message);
  }

  return data;
}

// Delete a conversation and its messages
export async function deleteConversation(conversationId: string): Promise<boolean> {
  console.log('[Supabase] Deleting conversation:', conversationId);
  
  // Delete messages first (due to foreign key constraint)
  const { error: msgError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId);

  if (msgError) {
    console.error('[Supabase] Error deleting messages:', msgError.message, msgError.details, msgError.hint);
    return false;
  }

  const { error: convError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (convError) {
    console.error('[Supabase] Error deleting conversation:', convError.message, convError.details, convError.hint);
    return false;
  }

  console.log('[Supabase] Conversation deleted successfully');
  return true;
}

// Update conversation title
export async function updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
  console.log('[Supabase] Updating conversation title:', conversationId, 'to:', title);
  
  const { error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId);

  if (error) {
    console.error('[Supabase] Error updating conversation title:', error.message, error.details, error.hint);
    return false;
  }

  console.log('[Supabase] Conversation title updated successfully');
  return true;
}
