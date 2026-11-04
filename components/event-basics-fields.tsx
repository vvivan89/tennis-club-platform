'use client';

import { Input } from '@/components/ui/input';
import type {
  EventFieldChange,
  EventFormValues,
  OrganizerOption,
} from '@/components/event-form-types';

export function EventBasicsFields({
  v,
  change,
  showOrganizerField,
  currentUserId,
  organizerOptions,
  onEventTypeChange,
}: {
  v: EventFormValues;
  change: EventFieldChange;
  showOrganizerField: boolean;
  currentUserId: string;
  organizerOptions: OrganizerOption[];
  onEventTypeChange: (value: string) => void;
}) {
  return (
    <section className="grid gap-4 rounded-xl border border-border p-5 sm:grid-cols-2">
      <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
          Event title
          <Input
            required
            maxLength={160}
            value={v.title}
            onChange={(e) => change('title', e.target.value)}
          />
        </label>
      </div>
      {showOrganizerField && (
        <label className="space-y-1 text-sm font-medium">
          Organizer
          <select
            required
            value={v.organizer_id ?? currentUserId}
            onChange={(e) => change('organizer_id', e.target.value)}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            {organizerOptions.map((organizer) => (
              <option key={organizer.id} value={organizer.id}>
                {organizer.full_name || organizer.email} ({organizer.role})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="space-y-1 text-sm font-medium">
        Event type
        <select
          value={
            v.event_type === 'tournament'
              ? v.is_league_tournament
                ? 'league_tournament'
                : v.tournament_format === 'team'
                  ? 'team_tournament'
                  : 'doubles_tournament'
              : v.event_type === 'social_doubles_ladder'
                ? 'social_doubles_ladder'
                : v.event_type === 'party'
                  ? 'party'
                  : 'social'
          }
          onChange={(e) => onEventTypeChange(e.target.value)}
          className="block h-10 w-full rounded-md border border-input bg-background px-3"
        >
          <option value="doubles_tournament">Doubles tournament</option>
          <option value="league_tournament">League</option>
          <option value="social">Social event</option>
          <option value="party">Party</option>
          <option value="social_doubles_ladder">Social Doubles Ladder</option>
          <option value="team_tournament">Team tournament</option>
        </select>
      </label>
      {v.event_type !== 'tournament' &&
        v.event_type !== 'social_doubles_ladder' &&
        v.event_type !== 'party' && (
          <label className="space-y-1 text-sm font-medium">
            Participant gender restriction (optional)
            <select
              value={v.gender_restriction ?? ''}
              onChange={(e) => change('gender_restriction', e.target.value || null)}
              className="block h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="">No restriction</option>
              <option value="male">Male participants only</option>
              <option value="female">Female participants only</option>
            </select>
          </label>
        )}
      <label className="space-y-1 text-sm font-medium">
        Publication
        <select
          value={v.status}
          onChange={(e) => change('status', e.target.value)}
          className="block h-10 w-full rounded-md border border-input bg-background px-3"
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      {(v.event_type !== 'tournament' || v.is_league_tournament) && (
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Description
          <textarea
            value={v.description}
            onChange={(e) => change('description', e.target.value)}
            maxLength={5000}
            className="min-h-24 w-full rounded-md border border-input bg-background p-3"
          />
        </label>
      )}
      <label className="space-y-1 text-sm font-medium">
        {v.event_type === 'party' ? 'Cost per member (CAD)' : 'Cost per person (CAD)'}
        <Input
          type="number"
          min="0"
          step="0.01"
          required
          value={(v.price_cents / 100).toString()}
          onChange={(e) => change('price_cents', Math.round(Number(e.target.value || 0) * 100))}
        />
      </label>
      {v.event_type === 'party' && (
        <div className="flex items-end gap-4 sm:col-span-2">
          <label className="flex min-h-10 shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.allow_plus_one}
              onChange={(e) => change('allow_plus_one', e.target.checked)}
            />{' '}
            Allow guests
          </label>
          {v.allow_plus_one && (
            <label className="w-full max-w-56 space-y-1 text-sm font-medium">
              Cost per guest (CAD)
              <Input
                type="number"
                min="0"
                step="0.01"
                required
                value={(v.guest_price_cents / 100).toString()}
                onChange={(e) =>
                  change('guest_price_cents', Math.round(Number(e.target.value || 0) * 100))
                }
              />
            </label>
          )}
        </div>
      )}
      <label className="space-y-1 text-sm font-medium">
        {v.event_type === 'tournament' && !v.is_league_tournament
          ? 'Total tournament capacity (optional)'
          : 'Maximum attendees'}
        <Input
          type="number"
          min="1"
          max="1000"
          required={v.event_type !== 'tournament' || v.is_league_tournament}
          value={
            v.event_type === 'tournament' && !v.is_league_tournament && v.capacity >= 1000000
              ? ''
              : v.capacity || ''
          }
          placeholder={
            v.event_type === 'tournament' && !v.is_league_tournament ? 'Unlimited' : undefined
          }
          onChange={(e) => change('capacity', e.target.value === '' ? 0 : Number(e.target.value))}
        />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Location
        <Input required value={v.location} onChange={(e) => change('location', e.target.value)} />
      </label>
      {v.event_type !== 'party' && (
        <label className="space-y-1 text-sm font-medium">
          Courts available
          <select
            value={v.court_count}
            onChange={(e) => change('court_count', Number(e.target.value))}
            className="block h-10 w-full rounded-md border border-input bg-background px-3"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {v.event_type !== 'tournament' && v.event_type !== 'party' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.members_only}
            onChange={(e) => change('members_only', e.target.checked)}
          />{' '}
          Active paid membership required
        </label>
      )}
      {v.event_type !== 'party' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.waitlist_enabled}
            onChange={(e) => change('waitlist_enabled', e.target.checked)}
          />{' '}
          Enable waitlist when full
        </label>
      )}
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Organizer notes
        <textarea
          value={v.notes}
          onChange={(e) => change('notes', e.target.value)}
          className="min-h-20 w-full rounded-md border border-input bg-background p-3"
        />
      </label>
    </section>
  );
}
