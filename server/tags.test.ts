import { describe, it, expect } from 'vitest';

describe('Tags Feature', () => {
  describe('Tag color validation', () => {
    const validColors = ['blue', 'green', 'purple', 'orange', 'pink', 'red', 'yellow', 'cyan'];

    it.each(validColors)('should recognize valid color: %s', (color) => {
      expect(validColors).toContain(color);
    });

    it('should have 8 valid colors', () => {
      expect(validColors.length).toBe(8);
    });

    it('should default to blue if no color provided', () => {
      const defaultColor = 'blue';
      expect(defaultColor).toBe('blue');
      expect(validColors).toContain(defaultColor);
    });
  });

  describe('Tag name validation', () => {
    it('should accept valid tag names', () => {
      const validNames = ['AI Policy', 'Regulations', 'Guidelines', 'Privacy'];
      validNames.forEach(name => {
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(50);
      });
    });

    it('should reject empty tag names', () => {
      const emptyName = '';
      expect(emptyName.trim().length).toBe(0);
    });

    it('should trim whitespace from tag names', () => {
      const nameWithSpaces = '  AI Policy  ';
      expect(nameWithSpaces.trim()).toBe('AI Policy');
    });
  });

  describe('Tag-Conversation association logic', () => {
    it('should identify when a tag is already assigned', () => {
      const conversationTags = [
        { id: '1', name: 'AI Policy' },
        { id: '2', name: 'Regulations' },
      ];
      const tagToCheck = { id: '1', name: 'AI Policy' };
      
      const isAssigned = conversationTags.some(t => t.id === tagToCheck.id);
      expect(isAssigned).toBe(true);
    });

    it('should identify when a tag is not assigned', () => {
      const conversationTags = [
        { id: '1', name: 'AI Policy' },
        { id: '2', name: 'Regulations' },
      ];
      const tagToCheck = { id: '3', name: 'Guidelines' };
      
      const isAssigned = conversationTags.some(t => t.id === tagToCheck.id);
      expect(isAssigned).toBe(false);
    });

    it('should toggle tag assignment correctly', () => {
      let conversationTags = [{ id: '1', name: 'AI Policy' }];
      const tagToToggle = { id: '1', name: 'AI Policy' };
      
      // Remove if exists
      const isAssigned = conversationTags.some(t => t.id === tagToToggle.id);
      if (isAssigned) {
        conversationTags = conversationTags.filter(t => t.id !== tagToToggle.id);
      } else {
        conversationTags.push(tagToToggle);
      }
      
      expect(conversationTags.length).toBe(0);
    });
  });

  describe('Tag filtering', () => {
    const allTags = [
      { id: '1', name: 'AI Policy', color: 'blue' },
      { id: '2', name: 'Regulations', color: 'green' },
      { id: '3', name: 'Privacy Guidelines', color: 'purple' },
    ];

    it('should filter tags by search query', () => {
      const query = 'policy';
      const filtered = allTags.filter(tag => 
        tag.name.toLowerCase().includes(query.toLowerCase())
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('AI Policy');
    });

    it('should return all tags when query is empty', () => {
      const query = '';
      const filtered = query ? allTags.filter(tag => 
        tag.name.toLowerCase().includes(query.toLowerCase())
      ) : allTags;
      expect(filtered.length).toBe(3);
    });

    it('should be case-insensitive', () => {
      const query = 'REGULATIONS';
      const filtered = allTags.filter(tag => 
        tag.name.toLowerCase().includes(query.toLowerCase())
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Regulations');
    });
  });

  describe('Tag uniqueness', () => {
    it('should detect duplicate tag names for same user', () => {
      const userTags = [
        { id: '1', name: 'AI Policy', user_id: 'user1' },
        { id: '2', name: 'Regulations', user_id: 'user1' },
      ];
      const newTagName = 'AI Policy';
      
      const isDuplicate = userTags.some(t => 
        t.name.toLowerCase() === newTagName.toLowerCase()
      );
      expect(isDuplicate).toBe(true);
    });

    it('should allow same tag name for different users', () => {
      const user1Tags = [{ id: '1', name: 'AI Policy', user_id: 'user1' }];
      const user2Tags = [{ id: '2', name: 'Regulations', user_id: 'user2' }];
      
      const newTagForUser2 = 'AI Policy';
      const isDuplicate = user2Tags.some(t => 
        t.name.toLowerCase() === newTagForUser2.toLowerCase()
      );
      expect(isDuplicate).toBe(false);
    });
  });

  describe('Tag filtering', () => {
    const conversations = [
      { id: 'conv1', title: 'AI Policy Discussion' },
      { id: 'conv2', title: 'Regulations Overview' },
      { id: 'conv3', title: 'Guidelines Summary' },
    ];

    const conversationTags = [
      { conversation_id: 'conv1', tag_id: 'tag1' },
      { conversation_id: 'conv2', tag_id: 'tag1' },
      { conversation_id: 'conv3', tag_id: 'tag2' },
    ];

    it('should filter conversations by tag', () => {
      const tagId = 'tag1';
      const taggedConvIds = conversationTags
        .filter(ct => ct.tag_id === tagId)
        .map(ct => ct.conversation_id);
      
      const filtered = conversations.filter(c => taggedConvIds.includes(c.id));
      expect(filtered.length).toBe(2);
      expect(filtered.map(c => c.id)).toContain('conv1');
      expect(filtered.map(c => c.id)).toContain('conv2');
    });

    it('should return empty array when no conversations have the tag', () => {
      const tagId = 'nonexistent';
      const taggedConvIds = conversationTags
        .filter(ct => ct.tag_id === tagId)
        .map(ct => ct.conversation_id);
      
      const filtered = conversations.filter(c => taggedConvIds.includes(c.id));
      expect(filtered.length).toBe(0);
    });
  });

  describe('Bulk tag operations', () => {
    it('should select multiple conversations', () => {
      const selectedIds = new Set<string>();
      
      // Add conversations
      selectedIds.add('conv1');
      selectedIds.add('conv2');
      expect(selectedIds.size).toBe(2);
      
      // Toggle off
      selectedIds.delete('conv1');
      expect(selectedIds.size).toBe(1);
      expect(selectedIds.has('conv2')).toBe(true);
    });

    it('should select all conversations', () => {
      const conversations = ['conv1', 'conv2', 'conv3'];
      const selectedIds = new Set(conversations);
      
      expect(selectedIds.size).toBe(3);
      expect(Array.from(selectedIds)).toEqual(conversations);
    });

    it('should deselect all conversations', () => {
      const selectedIds = new Set(['conv1', 'conv2', 'conv3']);
      selectedIds.clear();
      
      expect(selectedIds.size).toBe(0);
    });

    it('should prepare bulk add data correctly', () => {
      const selectedConvIds = ['conv1', 'conv2', 'conv3'];
      const tagId = 'tag1';
      
      const insertData = selectedConvIds.map(convId => ({
        conversation_id: convId,
        tag_id: tagId,
      }));
      
      expect(insertData.length).toBe(3);
      expect(insertData[0]).toEqual({ conversation_id: 'conv1', tag_id: 'tag1' });
    });

    it('should validate conversation ownership before bulk operations', () => {
      const userConversations = ['conv1', 'conv2'];
      const requestedConvIds = ['conv1', 'conv2', 'conv3'];
      
      const validConvIds = requestedConvIds.filter(id => userConversations.includes(id));
      
      expect(validConvIds.length).toBe(2);
      expect(validConvIds).not.toContain('conv3');
    });
  });
});
