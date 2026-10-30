import { describe, expect, it } from 'vitest';
import { actionLabel, auditChangeLines, safeAuditDetails } from '@/lib/audit-format';

describe('audit formatting', () => {
  it('formats multiple court movements and unassigned additions/removals in one entry', () => {
    const lines = auditChangeLines({
      target_table: 'event_court_assignments',
      changes: {
        player_changes: [
          {
            player_name: 'Alex Chen',
            player_id: 'p-1',
            session: 1,
            previous_court: 1,
            new_court: 2,
            change: 'moved',
          },
          {
            player_name: 'Jordan Lee',
            session: 1,
            previous_court: 2,
            new_court: 1,
            change: 'moved',
          },
          {
            player_name: 'Morgan Patel',
            session: 2,
            previous_court: null,
            new_court: 3,
            change: 'assigned',
          },
          {
            player_name: 'Taylor Wong',
            session: 2,
            previous_court: 4,
            new_court: null,
            change: 'unassigned',
          },
        ],
      },
    });

    expect(lines).toEqual([
      'Alex Chen — Session 1: Court 1 → Court 2',
      'Jordan Lee — Session 1: Court 2 → Court 1',
      'Morgan Patel — Session 2: Unassigned → Court 3',
      'Taylor Wong — Session 2: Court 4 → Unassigned',
    ]);
  });

  it('preserves legacy slots containing more than one court', () => {
    expect(
      auditChangeLines({
        changes: {
          player_changes: [
            {
              player_name: 'Alex Chen',
              session: 1,
              previous_courts: [1, 2],
              new_courts: [3],
            },
          ],
        },
      }),
    ).toEqual(['Alex Chen — Session 1: Courts 1, 2 → Court 3']);
  });

  it('formats registration additions, removals, replacement, and status changes', () => {
    const event = { event_id: 'event-1', event_name: 'Spring Singles League' };
    expect(
      auditChangeLines({
        changes: {
          affected_players: [
            { ...event, change: 'added', player_name: 'Alex Chen', new_status: 'confirmed' },
          ],
        },
      }),
    ).toEqual([
      'Added Alex Chen to Spring Singles League. Previous registration: none. New registration: confirmed.',
    ]);
    expect(
      auditChangeLines({
        changes: {
          affected_players: [
            { ...event, change: 'removed', player_name: 'Alex Chen', old_status: 'confirmed' },
          ],
        },
      }),
    ).toEqual([
      'Removed Alex Chen from Spring Singles League. Previous registration: confirmed. New registration: removed.',
    ]);
    expect(
      auditChangeLines({
        changes: {
          affected_players: [
            {
              ...event,
              change: 'replaced',
              player_name: 'Jordan Lee',
              previous_player_name: 'Alex Chen',
            },
          ],
        },
      }),
    ).toEqual(['Replaced Alex Chen with Jordan Lee in Spring Singles League.']);
    expect(
      auditChangeLines({
        changes: {
          affected_players: [
            {
              ...event,
              change: 'updated',
              player_name: 'Alex Chen',
              old_status: 'waitlisted',
              new_status: 'confirmed',
            },
          ],
        },
      }),
    ).toEqual(['Alex Chen: waitlisted → confirmed in Spring Singles League.']);
  });

  it('resolves event names and falls back to an available entity ID', () => {
    expect(
      auditChangeLines(
        {
          event_id: 'event-2',
          changes: {
            affected_players: [
              { change: 'added', player_id: 'player-2', new_status: 'waitlisted' },
            ],
          },
        },
        { 'event-2': 'Friday Doubles' },
      ),
    ).toEqual([
      'Added Player player-2 to Friday Doubles. Previous registration: none. New registration: waitlisted.',
    ]);
    expect(
      auditChangeLines({
        changes: {
          player_changes: [
            { player_id: 'player-3', session: 3, previous_court: null, new_court: 4 },
          ],
        },
      }),
    ).toEqual(['Player player-3 — Session 3: Unassigned → Court 4']);
  });

  it('formats actual field diffs, including null transitions, without unchanged fields', () => {
    expect(
      auditChangeLines({
        target_table: 'profiles',
        changes: {
          entities: [
            {
              type: 'profile',
              name: 'Alex Chen',
              operation: 'updated',
              field_changes: {
                tennis_skill_level: { old_value: '3.0', new_value: '3.5' },
                phone: { old_value: null, new_value: '604-555-0100' },
              },
            },
          ],
        },
      }),
    ).toEqual([
      'Alex Chen: Tennis Skill Level changed from 3.0 to 3.5.',
      'Alex Chen: Phone changed from none to 604-555-0100.',
    ]);
  });

  it('renders meaningful create/delete snapshots and honest legacy fallbacks', () => {
    expect(
      auditChangeLines({
        target_table: 'events',
        changes: {
          entities: [
            {
              operation: 'created',
              name: 'Spring League',
              new_values: { title: 'Spring League', capacity: 16, id: 'e-1' },
            },
          ],
        },
      }),
    ).toEqual(['Created Spring League: Title: Spring League; Capacity: 16.']);
    expect(
      auditChangeLines({
        target_table: 'events',
        changes: {
          entities: [
            {
              operation: 'deleted',
              name: 'Spring League',
              old_values: { title: 'Spring League', status: 'draft' },
            },
          ],
        },
      }),
    ).toEqual(['Deleted Spring League. Previous values: Title: Spring League; Status: draft.']);
    expect(
      auditChangeLines({
        target_table: 'events',
        changes: { affected_count: 4, sample_record: { title: 'Old event' } },
      }),
    ).toEqual([
      'Historical change details were not captured; this record only contains an affected-record count or sample.',
    ]);
    expect(auditChangeLines({ changes: null })).toEqual([]);
    expect(auditChangeLines({ changes: 'malformed' })).toEqual([]);
  });

  it('labels known and unknown actions and omits credential-like technical keys', () => {
    expect(actionLabel('event.registration.replaced')).toBe('Event participant replaced');
    expect(actionLabel('event.registration.admin_added')).toBe('Player added to event');
    expect(actionLabel('club_settings.update')).toBe('Club Setting updated');
    expect(
      safeAuditDetails({
        changes: { api_key: 'hidden', field_changes: { phone: { old: null, new: '123' } } },
      }),
    ).toEqual({
      changes: { field_changes: { phone: { old: null, new: '123' } } },
    });
  });

  it('formats waitlist/payment deltas and resolves field identifiers to known names', () => {
    expect(
      auditChangeLines(
        {
          changes: {
            affected_players: [
              {
                change: 'updated',
                player_id: 'player-1',
                old_queue_position: 3,
                new_queue_position: 1,
                old_payment_status: 'pending',
                new_payment_status: 'paid',
              },
            ],
          },
        },
        { 'player-1': 'Alex Chen' },
      ),
    ).toEqual(['Alex Chen: waitlist position 3 → 1; payment pending → paid in the event.']);

    expect(
      auditChangeLines(
        {
          target_table: 'profiles',
          changes: {
            entities: [
              {
                type: 'profile',
                name: 'Alex Chen',
                field_changes: {
                  user_id: { old: 'user-old', new: 'user-new' },
                  event_id: { old_value: 'event-old', new_value: 'event-new' },
                },
              },
            ],
          },
        },
        {
          'user-old': 'Former member',
          'user-new': 'Current member',
          'event-old': 'Old event',
          'event-new': 'New event',
        },
      ),
    ).toEqual([
      'Alex Chen: User Id changed from Former member to Current member.',
      'Alex Chen: Event Id changed from Old event to New event.',
    ]);
  });

  it('formats entity-specific changes and safely falls back for malformed snapshots', () => {
    expect(
      auditChangeLines({
        target_table: 'events',
        changes: {
          entities: [
            {
              type: 'court_assignment',
              player_name: 'Alex Chen',
              segment_order: 2,
              previous_courts: [],
              new_courts: [3, 4],
            },
            {
              type: 'registration',
              event_name: 'Summer Open',
              change: 'removed',
              player_name: 'Jordan Lee',
              old_status: 'confirmed',
            },
            {
              operation: 'updated',
              name: 'Membership',
              new_values: { id: 'm1', updated_at: 'ignored', enabled: false, note: '' },
            },
            { operation: 'archived', name: 'Legacy row', new_values: null },
            null,
          ],
        },
      }),
    ).toEqual([
      'Alex Chen — Session 2: Unassigned → Courts 3, 4',
      'Removed Jordan Lee from Summer Open. Previous registration: confirmed. New registration: removed.',
      'Updated Membership; field values were not captured.',
      'Archived Legacy row; field values were not captured.',
    ]);

    expect(actionLabel('custom.integration.created')).toBe('Custom Integration Created');
    expect(actionLabel('misc.action.completed')).toBe('Misc Action Completed');
  });

  it('filters credential keys recursively while preserving arrays and primitive values', () => {
    expect(
      safeAuditDetails([
        { authorization: 'hidden', nested: [{ access_token: 'hidden', visible: true }] },
        null,
        'plain text',
      ]),
    ).toEqual([{ nested: [{ visible: true }] }, null, 'plain text']);
  });
});
