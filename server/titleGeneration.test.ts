import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateConversationTitle, hasEnoughContextForTitle, ConversationMessage } from './titleGeneration';

// Mock the LLM module
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn()
}));

import { invokeLLM } from './_core/llm';

describe('Title Generation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasEnoughContextForTitle', () => {
    it('should return false for empty messages array', () => {
      expect(hasEnoughContextForTitle([])).toBe(false);
    });

    it('should return false for single message', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' }
      ];
      expect(hasEnoughContextForTitle(messages)).toBe(false);
    });

    it('should return false for only user messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'user', content: 'Anyone there?' }
      ];
      expect(hasEnoughContextForTitle(messages)).toBe(false);
    });

    it('should return false for only assistant messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Hello!' },
        { role: 'assistant', content: 'How can I help?' }
      ];
      expect(hasEnoughContextForTitle(messages)).toBe(false);
    });

    it('should return true for user and assistant messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is GDPR?' },
        { role: 'assistant', content: 'GDPR is the General Data Protection Regulation...' }
      ];
      expect(hasEnoughContextForTitle(messages)).toBe(true);
    });

    it('should return true for multiple exchanges', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Tell me about AI ethics' },
        { role: 'assistant', content: 'AI ethics covers several key areas...' },
        { role: 'user', content: 'What about bias?' },
        { role: 'assistant', content: 'Bias in AI systems is a critical concern...' }
      ];
      expect(hasEnoughContextForTitle(messages)).toBe(true);
    });
  });

  describe('generateConversationTitle', () => {
    it('should return "New Conversation" for empty messages', async () => {
      const result = await generateConversationTitle([]);
      expect(result).toBe('New Conversation');
    });

    it('should call LLM with proper prompt for valid messages', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'GDPR Compliance Overview'
          }
        }]
      };
      
      vi.mocked(invokeLLM).mockResolvedValue(mockResponse as any);

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is GDPR?' },
        { role: 'assistant', content: 'GDPR is the General Data Protection Regulation...' }
      ];

      const result = await generateConversationTitle(messages);
      
      expect(invokeLLM).toHaveBeenCalledTimes(1);
      expect(result).toBe('GDPR Compliance Overview');
    });

    it('should clean up title with quotes', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: '"AI Ethics Discussion"'
          }
        }]
      };
      
      vi.mocked(invokeLLM).mockResolvedValue(mockResponse as any);

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Tell me about AI ethics' },
        { role: 'assistant', content: 'AI ethics is important...' }
      ];

      const result = await generateConversationTitle(messages);
      expect(result).toBe('AI Ethics Discussion');
    });

    it('should remove trailing punctuation', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Data Privacy Questions.'
          }
        }]
      };
      
      vi.mocked(invokeLLM).mockResolvedValue(mockResponse as any);

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'How do I handle user data?' },
        { role: 'assistant', content: 'When handling user data...' }
      ];

      const result = await generateConversationTitle(messages);
      expect(result).toBe('Data Privacy Questions');
    });

    it('should truncate very long titles', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'This is a very long title that exceeds the maximum allowed length and should be truncated to ensure proper display in the UI'
          }
        }]
      };
      
      vi.mocked(invokeLLM).mockResolvedValue(mockResponse as any);

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Complex question' },
        { role: 'assistant', content: 'Complex answer' }
      ];

      const result = await generateConversationTitle(messages);
      expect(result.length).toBeLessThanOrEqual(60);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should fallback to first message on LLM error', async () => {
      vi.mocked(invokeLLM).mockRejectedValue(new Error('API Error'));

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What are OpenAI usage policies?' },
        { role: 'assistant', content: 'OpenAI has several policies...' }
      ];

      const result = await generateConversationTitle(messages);
      expect(result).toBe('What are OpenAI usage policies?');
    });

    it('should handle LLM returning empty content', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: ''
          }
        }]
      };
      
      vi.mocked(invokeLLM).mockResolvedValue(mockResponse as any);

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Test question' },
        { role: 'assistant', content: 'Test answer' }
      ];

      const result = await generateConversationTitle(messages);
      // Falls back to first user message when LLM returns empty
      expect(result).toBe('Test question');
    });

    it('should limit context to first 10 messages', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Long Conversation Summary'
          }
        }]
      };
      
      vi.mocked(invokeLLM).mockResolvedValue(mockResponse as any);

      // Create 15 messages
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 15; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`
        });
      }

      await generateConversationTitle(messages);
      
      // Check that the LLM was called
      expect(invokeLLM).toHaveBeenCalledTimes(1);
      
      // Verify the prompt only contains first 10 messages
      const callArgs = vi.mocked(invokeLLM).mock.calls[0][0];
      const userPrompt = callArgs.messages.find(m => m.role === 'user')?.content as string;
      
      // Should contain Message 1 through Message 10, but not Message 11+
      expect(userPrompt).toContain('Message 1');
      expect(userPrompt).toContain('Message 10');
      expect(userPrompt).not.toContain('Message 11');
    });
  });
});
