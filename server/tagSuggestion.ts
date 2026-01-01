import { invokeLLM } from "./_core/llm";

interface TagSuggestion {
  name: string;
  confidence: number;
  reason: string;
}

interface SuggestTagsResult {
  suggestions: TagSuggestion[];
  success: boolean;
  error?: string;
}

/**
 * Analyze conversation content and suggest relevant tags using LLM
 */
export async function suggestTagsForConversation(
  messages: Array<{ role: string; content: string }>,
  existingTags: Array<{ id: string; name: string; color: string }>
): Promise<SuggestTagsResult> {
  if (!messages || messages.length === 0) {
    return {
      suggestions: [],
      success: false,
      error: "No messages to analyze"
    };
  }

  // Build conversation context
  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n')
    .slice(0, 3000); // Limit context size

  // Build list of existing tags for the LLM to consider
  const existingTagNames = existingTags.map(t => t.name);
  const existingTagsContext = existingTagNames.length > 0
    ? `\n\nExisting tags the user has created: ${existingTagNames.join(', ')}`
    : '';

  const systemPrompt = `You are a conversation tagging assistant. Analyze the conversation and suggest 2-4 relevant tags that would help organize and categorize it.

Guidelines:
- Suggest tags that capture the main topics, themes, or categories discussed
- Tags should be concise (1-3 words each)
- Prioritize suggesting from existing tags when they fit well
- Also suggest new tags if the conversation covers topics not in existing tags
- Focus on policy-related categories like: regulations, compliance, ethics, privacy, AI governance, platform terms, legal, etc.
- Each tag should have a confidence score (0.0-1.0) and a brief reason

${existingTagsContext}

Respond in JSON format:
{
  "suggestions": [
    {"name": "tag name", "confidence": 0.9, "reason": "brief explanation"},
    ...
  ]
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this conversation and suggest tags:\n\n${conversationText}` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tag_suggestions",
          strict: true,
          schema: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "The tag name (1-3 words)" },
                    confidence: { type: "number", description: "Confidence score 0.0-1.0" },
                    reason: { type: "string", description: "Brief explanation for this suggestion" }
                  },
                  required: ["name", "confidence", "reason"],
                  additionalProperties: false
                }
              }
            },
            required: ["suggestions"],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return {
        suggestions: [],
        success: false,
        error: "Empty response from LLM"
      };
    }

    const parsed = JSON.parse(content as string);
    
    // Validate and normalize suggestions
    const suggestions: TagSuggestion[] = (parsed.suggestions || [])
      .filter((s: any) => s.name && typeof s.confidence === 'number')
      .map((s: any) => ({
        name: String(s.name).trim().slice(0, 30),
        confidence: Math.max(0, Math.min(1, s.confidence)),
        reason: String(s.reason || '').slice(0, 100)
      }))
      .slice(0, 5); // Max 5 suggestions

    // Sort by confidence descending
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return {
      suggestions,
      success: true
    };
  } catch (error) {
    console.error('[TagSuggestion] Error:', error);
    return {
      suggestions: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check if a suggested tag matches an existing tag (case-insensitive)
 */
export function findMatchingExistingTag(
  suggestion: string,
  existingTags: Array<{ id: string; name: string; color: string }>
): { id: string; name: string; color: string } | null {
  const normalizedSuggestion = suggestion.toLowerCase().trim();
  return existingTags.find(
    tag => tag.name.toLowerCase().trim() === normalizedSuggestion
  ) || null;
}
