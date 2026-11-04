import type { HelpGuideTopic } from '@/components/help-guides/navigation';

export type EventTournamentHelpTab = 'events' | 'tournaments';

export const sharedEventTournamentTopics = [
  ['events', 'admin-event-types', 'Event types'],
  ['events', 'admin-event-create', 'Shared fields and timing'],
  ['events', 'admin-event-social', 'Social events'],
  ['events', 'admin-event-party', 'Parties'],
  ['events', 'admin-event-doubles', 'Doubles tournaments'],
  ['events', 'admin-event-league', 'Leagues'],
  ['events', 'admin-event-team', 'Team tournaments'],
  ['events', 'admin-event-ladder', 'Doubles ladders'],
  ['events', 'admin-event-management', 'Event management'],
  ['events', 'admin-event-editing', 'Edit events and participants'],
  ['events', 'admin-event-replacement', 'Replace an event participant'],
  ['events', 'admin-event-courts', 'Assign event courts'],
  ['tournaments', 'admin-tournament-entries', 'Tournament participants'],
  ['tournaments', 'admin-tournament-round-robin', 'Round robin groups and matches'],
  ['tournaments', 'admin-tournament-automated-draw', 'Automated draws'],
  ['tournaments', 'admin-tournament-scheduling', 'Automated scheduling'],
  ['tournaments', 'admin-tournament-standings', 'Standings and promotions'],
  ['tournaments', 'admin-tournament-knockout', 'Knockout stages'],
  ['tournaments', 'admin-tournament-winners', 'Announce winners'],
  ['tournaments', 'admin-tournament-audit', 'Tournament history'],
] as const satisfies readonly HelpGuideTopic<EventTournamentHelpTab>[];
