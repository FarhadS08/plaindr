import { invokeLLM } from "./_core/llm";

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Generate a concise, meaningful title for a conversation using AI.
 * 
 * The title should be:
 * - 3-6 words maximum
 * - No filler words or full sentences
 * - Capture the primary intent/outcome
 * - Clear, meaningful, and searchable
 * - Differentiate similar conversations
 * 
 * @param messages - Array of conversation messages
 * @param currentTitle - Optional current title to avoid generating the same one
 * @returns Generated title string
 */
export async function generateConversationTitle(
  messages: ConversationMessage[], 
  currentTitle?: string
): Promise<string> {
  // If no messages or very short conversation, return a default
  if (!messages || messages.length === 0) {
    return "New Conversation";
  }

  // Build conversation context (limit to first 10 messages to avoid token limits)
  const contextMessages = messages.slice(0, 10);
  const conversationText = contextMessages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  // Add randomness seed to encourage variety
  const randomSeed = Math.random().toString(36).substring(2, 8);
  
  // Build the system prompt with regeneration awareness
  let systemPrompt = `You are a creative title generator for conversation histories. Your task is to create short, descriptive titles that capture the essence of conversations.

RULES:
1. Title MUST be 3-6 words only
2. NO filler words (like "Discussion about", "Conversation on", "Help with")
3. NO full sentences or punctuation at the end
4. Capture the PRIMARY intent or outcome
5. Make it SEARCHABLE - use specific keywords
6. Differentiate from similar topics
7. Be CREATIVE and VARIED in your word choices

EXAMPLES:
- Good: "Calendar Interaction Bugs"
- Good: "Stripe Payment Flow"
- Good: "AI Policy Compliance Check"
- Good: "GDPR Data Retention Rules"
- Good: "Model Training Guidelines"
- Good: "Voice Assistant Setup"
- Good: "Platform Terms Analysis"
- Bad: "Discussion about calendar issues" (too long, has filler)
- Bad: "Help" (too vague)
- Bad: "A conversation about AI policies and regulations" (too long, sentence format)`;

  // If regenerating, explicitly tell the LLM to create a DIFFERENT title
  if (currentTitle && currentTitle !== "New Conversation") {
    systemPrompt += `

IMPORTANT: The current title is "${currentTitle}". You MUST generate a COMPLETELY DIFFERENT title that:
- Uses different words and phrasing
- Focuses on a different aspect of the conversation
- Is NOT similar to the current title
- Provides a fresh perspective on the conversation topic

DO NOT use any words from the current title. Be creative!`;
  }

  systemPrompt += `

Output ONLY the title, nothing else. (Seed: ${randomSeed})`;

  const userPrompt = `Generate a ${currentTitle ? 'NEW and DIFFERENT' : ''} title for this conversation:

${conversationText}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 50, // Short output expected
    });

    const generatedTitle = response.choices[0]?.message?.content;
    
    if (typeof generatedTitle === 'string' && generatedTitle.trim()) {
      // Clean up the title - remove quotes, extra whitespace, trailing punctuation
      let cleanTitle = generatedTitle
        .trim()
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes
        .replace(/[.!?]$/, '') // Remove trailing punctuation
        .replace(/\(Seed:.*\)/g, '') // Remove any seed that might have leaked
        .trim();
      
      // Ensure title isn't too long (max 60 chars as safety)
      if (cleanTitle.length > 60) {
        cleanTitle = cleanTitle.substring(0, 57) + '...';
      }
      
      // If we got the same title back, try a fallback approach
      if (currentTitle && cleanTitle.toLowerCase() === currentTitle.toLowerCase()) {
        // Generate a variation by focusing on different aspects
        const aspects = ['topic', 'action', 'outcome', 'subject'];
        const randomAspect = aspects[Math.floor(Math.random() * aspects.length)];
        console.log(`[TitleGeneration] Same title returned, will use alternative approach focusing on ${randomAspect}`);
        
        // Return a modified version to ensure it's different
        const words = cleanTitle.split(' ');
        if (words.length > 1) {
          // Shuffle word order or add context
          return words.reverse().join(' ');
        }
      }
      
      return cleanTitle || "New Conversation";
    }

    return "New Conversation";
  } catch (error) {
    console.error('[TitleGeneration] Error generating title:', error);
    // Fallback to first message truncation
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      const fallback = firstUserMessage.content.slice(0, 50);
      return fallback + (firstUserMessage.content.length > 50 ? '...' : '');
    }
    return "New Conversation";
  }
}

/**
 * Check if a conversation has enough context to generate a meaningful title.
 * We want at least one user message and one assistant response.
 */
export function hasEnoughContextForTitle(messages: ConversationMessage[]): boolean {
  if (!messages || messages.length < 2) return false;
  
  const hasUserMessage = messages.some(m => m.role === 'user');
  const hasAssistantMessage = messages.some(m => m.role === 'assistant');
  
  return hasUserMessage && hasAssistantMessage;
}
