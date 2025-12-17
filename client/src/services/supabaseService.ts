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
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: title || 'New Conversation',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating conversation:', error);
    return null;
  }

  return data;
}

// Get all conversations for a user
export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }

  return data || [];
}

// Get a single conversation with messages
export async function getConversationWithMessages(conversationId: string): Promise<{ conversation: Conversation; messages: Message[] } | null> {
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (convError) {
    console.error('Error fetching conversation:', convError);
    return null;
  }

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('Error fetching messages:', msgError);
    return null;
  }

  return { conversation, messages: messages || [] };
}

// Add a message to a conversation
export async function addMessage(conversationId: string, role: 'user' | 'assistant', content: string): Promise<Message | null> {
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
    console.error('Error adding message:', error);
    return null;
  }

  // Update conversation's updated_at timestamp
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return data;
}

// Delete a conversation and its messages
export async function deleteConversation(conversationId: string): Promise<boolean> {
  // Delete messages first (due to foreign key constraint)
  const { error: msgError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId);

  if (msgError) {
    console.error('Error deleting messages:', msgError);
    return false;
  }

  const { error: convError } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (convError) {
    console.error('Error deleting conversation:', convError);
    return false;
  }

  return true;
}

// Update conversation title
export async function updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
  const { error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId);

  if (error) {
    console.error('Error updating conversation title:', error);
    return false;
  }

  return true;
}
