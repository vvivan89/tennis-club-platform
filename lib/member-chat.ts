import type { SupabaseClient } from '@supabase/supabase-js';

export const CHAT_IMAGE_MAX_BYTES = 1024 * 1024;
export const CHAT_ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
export const CHAT_EDIT_WINDOW_MS = 5 * 60 * 1000;
export const CHAT_PAGE_SIZE = 100;

/** Persist the same latest-message read cursor used when opening the chat page. */
export async function markMemberChatAsRead(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: latestMessage } = await supabase
    .from('member_chat_messages')
    .select('id,created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastReadAt = latestMessage?.created_at ?? new Date().toISOString();
  await supabase.from('member_chat_reads').upsert({
    user_id: userId,
    last_read_at: lastReadAt,
    last_read_message_id: latestMessage?.id ?? null,
  });
}

export function canEditChatMessage(createdAt: string, now = Date.now()): boolean {
  const sentAt = new Date(createdAt).getTime();
  return Number.isFinite(sentAt) && now >= sentAt && now - sentAt < CHAT_EDIT_WINDOW_MS;
}

export function validateChatImage(file: Pick<File, 'type' | 'size'>): string | null {
  if (!CHAT_ALLOWED_IMAGE_TYPES.includes(file.type as (typeof CHAT_ALLOWED_IMAGE_TYPES)[number])) {
    return 'Choose a JPEG, PNG, GIF, or WebP image.';
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) return 'Images must be 1 MB or smaller.';
  return null;
}

export function countUnreadMessages(totalOtherMessages: number | null): number {
  if (totalOtherMessages === null || !Number.isFinite(totalOtherMessages)) return 0;
  return Math.max(0, Math.floor(totalOtherMessages));
}

export type ChatNotificationPreference = 'all' | 'mentions' | 'none';

export function shouldShowChatNotification(
  preference: ChatNotificationPreference,
  senderId: string,
  currentUserId: string,
  mentions: readonly string[] = [],
): boolean {
  if (senderId === currentUserId || preference === 'none') return false;
  if (preference === 'mentions') return mentions.includes(currentUserId);
  return preference === 'all';
}
