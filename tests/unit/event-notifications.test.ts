import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchEventNotificationsInBackground } from '@/lib/event-notifications';
import { sendResendEmail } from '@/lib/resend';
import { parseBracketSlots } from '@/lib/tournament-match';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dispatchEventNotificationsInBackground', () => {
  it('posts a single event id or a list of ids', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    dispatchEventNotificationsInBackground('event-1', 'Test');
    dispatchEventNotificationsInBackground(['a', 'b'], 'Test');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ eventId: 'event-1' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ eventIds: ['a', 'b'] });
  });

  it('logs rejected requests and failed deliveries instead of swallowing them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    dispatchEventNotificationsInBackground('event-1', 'Test');
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[Test] Email notification request failed',
        expect.any(Error),
      ),
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ failed: 2 }), { status: 200 }));
    dispatchEventNotificationsInBackground('event-1', 'Test');
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[Test] Email notification dispatch failed',
        expect.objectContaining({ status: 200 }),
      ),
    );
  });
});

describe('sendResendEmail', () => {
  it('adds an Idempotency-Key header only when a key is given', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await sendResendEmail({
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      apiKey: 'k',
      from: 'f@example.com',
    });
    await sendResendEmail({
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      apiKey: 'k',
      from: 'f@example.com',
      idempotencyKey: 'key-1',
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe('key-1');
  });
});

describe('parseBracketSlots', () => {
  it('reads slot labels and falls back to empty slots for missing or invalid notes', () => {
    expect(parseBracketSlots('{"slot_one":"Group 1 Team 1","slot_two":"Bye"}')).toEqual([
      'Group 1 Team 1',
      'Bye',
    ]);
    expect(parseBracketSlots('{"slot_one":"Only one"}')).toEqual(['Only one', null]);
    expect(parseBracketSlots(null)).toEqual([null, null]);
    expect(parseBracketSlots('Walkover / retirement awarded to side one')).toEqual([null, null]);
  });
});
