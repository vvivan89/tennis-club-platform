import { describe, expect, it } from 'vitest';
import { eventEditPath, eventPath } from '../../lib/event-slug';

describe('event URL helpers', () => {
  it('uses a readable slug for public event URLs', () => {
    expect(eventPath({ id: 'event-123', slug: 'fall-round-robin-2026-10-22-18-00' })).toBe(
      '/events/fall-round-robin-2026-10-22-18-00',
    );
  });

  it('falls back to the event ID when no slug is available', () => {
    expect(eventPath({ id: 'event-123', slug: null })).toBe('/events/event-123');
    expect(eventPath({ id: 'event-123' })).toBe('/events/event-123');
    expect(eventPath({ id: 'event-123', slug: '' })).toBe('/events/event-123');
    expect(eventEditPath({ id: 'event-123', slug: '' })).toBe('/admin/events/event-123/edit');
  });

  it('uses the same slug for the admin edit route', () => {
    expect(eventEditPath({ id: 'event-123', slug: 'club-championship' })).toBe(
      '/admin/events/club-championship/edit',
    );
  });
});
