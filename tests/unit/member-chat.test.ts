import { describe, expect, it } from 'vitest';
import {
  canEditChatMessage,
  CHAT_EDIT_WINDOW_MS,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_PAGE_SIZE,
  countUnreadMessages,
  shouldShowChatNotification,
  validateChatImage,
} from '@/lib/member-chat';

describe('member chat rules', () => {
  it('loads chat history in pages of 100 messages', () => {
    expect(CHAT_PAGE_SIZE).toBe(100);
  });

  it('allows edits strictly within the five-minute window', () => {
    const now = Date.parse('2026-10-24T12:05:00.000Z');
    expect(canEditChatMessage(new Date(now - CHAT_EDIT_WINDOW_MS + 1).toISOString(), now)).toBe(
      true,
    );
    expect(canEditChatMessage(new Date(now - CHAT_EDIT_WINDOW_MS).toISOString(), now)).toBe(false);
    expect(canEditChatMessage(new Date(now + 1).toISOString(), now)).toBe(false);
    expect(canEditChatMessage('not-a-date', now)).toBe(false);
  });

  it('accepts supported image types up to and including 1 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(validateChatImage({ type, size: CHAT_IMAGE_MAX_BYTES })).toBeNull();
    }
    expect(validateChatImage({ type: 'image/svg+xml', size: 10 })).toContain('JPEG');
    expect(validateChatImage({ type: 'image/png', size: CHAT_IMAGE_MAX_BYTES + 1 })).toContain(
      '1 MB',
    );
  });

  it('applies chat notification preferences without notifying senders about their own messages', () => {
    expect(shouldShowChatNotification('all', 'other', 'me')).toBe(true);
    expect(shouldShowChatNotification('mentions', 'other', 'me', ['me'])).toBe(true);
    expect(shouldShowChatNotification('mentions', 'other', 'me', ['someone-else'])).toBe(false);
    expect(shouldShowChatNotification('none', 'other', 'me', ['me'])).toBe(false);
    expect(shouldShowChatNotification('all', 'me', 'me', ['me'])).toBe(false);
  });

  it('normalizes unread counts and handles unavailable counts safely', () => {
    expect(countUnreadMessages(7)).toBe(7);
    expect(countUnreadMessages(0)).toBe(0);
    expect(countUnreadMessages(-3)).toBe(0);
    expect(countUnreadMessages(null)).toBe(0);
    expect(countUnreadMessages(Number.NaN)).toBe(0);
  });
});
