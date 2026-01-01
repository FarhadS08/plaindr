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

  // Try up to 3 times to get a different title
  const maxRetries = currentTitle ? 3 : 1;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Add randomness seed to encourage variety - different each attempt
    const randomSeed = Math.random().toString(36).substring(2, 10);
    const timestamp = Date.now();
    
    // Different focus angles for each retry
    const focusAngles = [
      'the main topic or subject matter',
      'the key action or request being made',
      'the specific outcome or goal',
      'the unique context or situation'
    ];
    const focusAngle = focusAngles[attempt % focusAngles.length];
    
    // Build the system prompt with regeneration awareness
    let systemPrompt = `You are a creative title generator. Create a SHORT title (3-6 words) for conversations.

STRICT RULES:
1. EXACTLY 3-6 words - no more, no less
2. NO filler phrases like "Discussion about", "Help with", "Question on"
3. NO punctuation at the end
4. Use SPECIFIC keywords from the conversation
5. Focus on: ${focusAngle}

GOOD EXAMPLES:
- "GDPR Data Retention Rules"
- "Voice Assistant Configuration"
- "Platform Content Guidelines"
- "AI Ethics Framework Review"
- "Payment Integration Setup"

BAD EXAMPLES (avoid these patterns):
- "Discussion about X" (has filler)
- "Help" (too vague)
- "A conversation about..." (sentence format)`;

    // If regenerating, be VERY explicit about needing a different title
    if (currentTitle && currentTitle !== "New Conversation") {
      systemPrompt += `

⚠️ CRITICAL REQUIREMENT ⚠️
The current title is: "${currentTitle}"

You MUST create a COMPLETELY DIFFERENT title:
- DO NOT use the words: ${currentTitle.split(' ').filter(w => w.length > 3).join(', ')}
- Focus on a DIFFERENT aspect of the conversation
- Use DIFFERENT vocabulary and phrasing
- Think of an alternative angle or perspective

This is attempt ${attempt + 1}. Be MORE creative and DIFFERENT than before!
Random seed for variety: ${randomSeed}-${timestamp}`;
    }

    systemPrompt += `

Respond with ONLY the title text, nothing else.`;

    const userPrompt = currentTitle 
      ? `Create a BRAND NEW title (different from "${currentTitle}") for this conversation:\n\n${conversationText}`
      : `Create a title for this conversation:\n\n${conversationText}`;

    try {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 50,
        // Note: temperature not supported by current LLM interface
      });

      const generatedTitle = response.choices[0]?.message?.content;
      
      if (typeof generatedTitle === 'string' && generatedTitle.trim()) {
        // Clean up the title
        let cleanTitle = generatedTitle
          .trim()
          .replace(/^["']|["']$/g, '') // Remove surrounding quotes
          .replace(/[.!?]$/, '') // Remove trailing punctuation
          .replace(/\(.*\)/g, '') // Remove any parenthetical content
          .replace(/^(Title:|New Title:)\s*/i, '') // Remove "Title:" prefix if present
          .trim();
        
        // Ensure title isn't too long (max 60 chars as safety)
        if (cleanTitle.length > 60) {
          cleanTitle = cleanTitle.substring(0, 57) + '...';
        }
        
        // Check if we got a different title
        if (!currentTitle || !isSameTitle(cleanTitle, currentTitle)) {
          console.log(`[TitleGeneration] Generated new title: "${cleanTitle}" (attempt ${attempt + 1})`);
          return cleanTitle || "New Conversation";
        }
        
        console.log(`[TitleGeneration] Same title returned on attempt ${attempt + 1}, retrying...`);
      }
    } catch (error) {
      console.error(`[TitleGeneration] Error on attempt ${attempt + 1}:`, error);
    }
  }

  // If all retries failed to produce a different title, create a variation manually
  if (currentTitle) {
    console.log('[TitleGeneration] All retries returned same title, creating manual variation');
    return createTitleVariation(currentTitle, messages);
  }

  // Fallback to first message truncation
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (firstUserMessage) {
    const fallback = firstUserMessage.content.slice(0, 50);
    return fallback + (firstUserMessage.content.length > 50 ? '...' : '');
  }
  return "New Conversation";
}

/**
 * Check if two titles are essentially the same (case-insensitive, ignoring minor differences)
 */
function isSameTitle(title1: string, title2: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(title1) === normalize(title2);
}

/**
 * Create a variation of the current title by extracting keywords from messages
 */
function createTitleVariation(currentTitle: string, messages: ConversationMessage[]): string {
  // Extract potential keywords from messages
  const allText = messages.map(m => m.content).join(' ');
  const words = allText.split(/\s+/)
    .filter(w => w.length > 4) // Only words longer than 4 chars
    .filter(w => !currentTitle.toLowerCase().includes(w.toLowerCase())) // Not in current title
    .filter(w => /^[a-zA-Z]+$/.test(w)); // Only alphabetic words
  
  // Get unique words
  const uniqueWords = Array.from(new Set(words));
  
  if (uniqueWords.length >= 2) {
    // Pick 2-3 random keywords to form a new title
    const shuffled = uniqueWords.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3);
    return selected.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  
  // Last resort: add a descriptor to differentiate
  const descriptors = ['Overview', 'Details', 'Analysis', 'Summary', 'Review', 'Guide'];
  const randomDescriptor = descriptors[Math.floor(Math.random() * descriptors.length)];
  
  // Shorten current title if needed and add descriptor
  const shortTitle = currentTitle.split(' ').slice(0, 3).join(' ');
  return `${shortTitle} ${randomDescriptor}`;
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
