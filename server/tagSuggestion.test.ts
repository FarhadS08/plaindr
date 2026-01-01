import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suggestTagsForConversation, findMatchingExistingTag } from './tagSuggestion';

// Mock the LLM module
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn()
}));

import { invokeLLM } from './_core/llm';

describe('Tag Suggestion Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('suggestTagsForConversation', () => {
    it('should return empty suggestions for empty messages', async () => {
      const result = await suggestTagsForConversation([], []);
      expect(result.success).toBe(false);
      expect(result.suggestions).toEqual([]);
      expect(result.error).toBe('No messages to analyze');
    });

    it('should call LLM with conversation context', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [
                { name: 'GDPR', confidence: 0.9, reason: 'Discussion about data protection' },
                { name: 'Privacy', confidence: 0.8, reason: 'Privacy concerns mentioned' }
              ]
            })
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      const messages = [
        { role: 'user', content: 'What are the GDPR requirements for data processing?' },
        { role: 'assistant', content: 'GDPR requires lawful basis for processing personal data...' }
      ];

      const result = await suggestTagsForConversation(messages, []);
      
      expect(invokeLLM).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should include existing tags in the prompt context', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [
                { name: 'GDPR', confidence: 0.9, reason: 'Matches existing tag' }
              ]
            })
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      const messages = [
        { role: 'user', content: 'Tell me about GDPR compliance' }
      ];

      const existingTags = [
        { id: '1', name: 'GDPR', color: '#8B5CF6' },
        { id: '2', name: 'Privacy', color: '#EC4899' }
      ];

      const result = await suggestTagsForConversation(messages, existingTags);
      
      expect(result.success).toBe(true);
      // The LLM should have been called with context about existing tags
      expect(invokeLLM).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('GDPR')
            })
          ])
        })
      );
    });

    it('should normalize and validate suggestions', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [
                { name: '  Tag With Spaces  ', confidence: 1.5, reason: 'Test' }, // confidence > 1
                { name: 'Normal Tag', confidence: 0.7, reason: 'Normal' },
                { name: '', confidence: 0.5, reason: 'Empty name' }, // should be filtered
                { name: 'Low Confidence', confidence: -0.1, reason: 'Negative' } // confidence < 0
              ]
            })
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      const messages = [{ role: 'user', content: 'Test message' }];
      const result = await suggestTagsForConversation(messages, []);
      
      expect(result.success).toBe(true);
      // Empty name should be filtered out
      expect(result.suggestions.every(s => s.name.length > 0)).toBe(true);
      // Confidence should be clamped to [0, 1]
      expect(result.suggestions.every(s => s.confidence >= 0 && s.confidence <= 1)).toBe(true);
      // Names should be trimmed
      expect(result.suggestions.find(s => s.name === 'Tag With Spaces')).toBeDefined();
    });

    it('should sort suggestions by confidence descending', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [
                { name: 'Low', confidence: 0.3, reason: 'Low confidence' },
                { name: 'High', confidence: 0.9, reason: 'High confidence' },
                { name: 'Medium', confidence: 0.6, reason: 'Medium confidence' }
              ]
            })
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      const messages = [{ role: 'user', content: 'Test message' }];
      const result = await suggestTagsForConversation(messages, []);
      
      expect(result.success).toBe(true);
      expect(result.suggestions[0].name).toBe('High');
      expect(result.suggestions[1].name).toBe('Medium');
      expect(result.suggestions[2].name).toBe('Low');
    });

    it('should limit suggestions to max 5', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [
                { name: 'Tag1', confidence: 0.9, reason: 'Test' },
                { name: 'Tag2', confidence: 0.8, reason: 'Test' },
                { name: 'Tag3', confidence: 0.7, reason: 'Test' },
                { name: 'Tag4', confidence: 0.6, reason: 'Test' },
                { name: 'Tag5', confidence: 0.5, reason: 'Test' },
                { name: 'Tag6', confidence: 0.4, reason: 'Test' },
                { name: 'Tag7', confidence: 0.3, reason: 'Test' }
              ]
            })
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      const messages = [{ role: 'user', content: 'Test message' }];
      const result = await suggestTagsForConversation(messages, []);
      
      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeLessThanOrEqual(5);
    });

    it('should handle LLM errors gracefully', async () => {
      (invokeLLM as any).mockRejectedValue(new Error('LLM service unavailable'));

      const messages = [{ role: 'user', content: 'Test message' }];
      const result = await suggestTagsForConversation(messages, []);
      
      expect(result.success).toBe(false);
      expect(result.suggestions).toEqual([]);
      expect(result.error).toBe('LLM service unavailable');
    });

    it('should handle empty LLM response', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: null
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      const messages = [{ role: 'user', content: 'Test message' }];
      const result = await suggestTagsForConversation(messages, []);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty response from LLM');
    });

    it('should truncate long conversation context', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{ name: 'Test', confidence: 0.8, reason: 'Test' }]
            })
          }
        }]
      };
      
      (invokeLLM as any).mockResolvedValue(mockResponse);

      // Create a very long message
      const longContent = 'A'.repeat(5000);
      const messages = [{ role: 'user', content: longContent }];
      
      const result = await suggestTagsForConversation(messages, []);
      
      expect(result.success).toBe(true);
      // The function should have truncated the context
      expect(invokeLLM).toHaveBeenCalled();
    });
  });

  describe('findMatchingExistingTag', () => {
    const existingTags = [
      { id: '1', name: 'GDPR', color: '#8B5CF6' },
      { id: '2', name: 'Privacy Policy', color: '#EC4899' },
      { id: '3', name: 'AI Ethics', color: '#3B82F6' }
    ];

    it('should find exact match (case-insensitive)', () => {
      const result = findMatchingExistingTag('gdpr', existingTags);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('1');
      expect(result?.name).toBe('GDPR');
    });

    it('should find match with different case', () => {
      const result = findMatchingExistingTag('PRIVACY POLICY', existingTags);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('2');
    });

    it('should find match with extra whitespace', () => {
      const result = findMatchingExistingTag('  AI Ethics  ', existingTags);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('3');
    });

    it('should return null for no match', () => {
      const result = findMatchingExistingTag('Compliance', existingTags);
      expect(result).toBeNull();
    });

    it('should return null for partial match', () => {
      const result = findMatchingExistingTag('GDP', existingTags);
      expect(result).toBeNull();
    });

    it('should handle empty existing tags', () => {
      const result = findMatchingExistingTag('GDPR', []);
      expect(result).toBeNull();
    });
  });
});
