export type AuditEntryLike = {
  action?: unknown;
  summary?: unknown;
  target_table?: unknown;
  target_record_id?: unknown;
  event_id?: unknown;
  changes?: unknown;
  metadata?: unknown;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function text(value: unknown, fallback = 'unknown'): string {
  if (value === null) return 'none';
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function title(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventName(
  change: JsonRecord,
  entry: AuditEntryLike,
  names: Record<string, string>,
): string {
  const eventId = text(change.event_id ?? entry.event_id, '');
  return text(
    change.event_name ?? (eventId ? names[eventId] : undefined) ?? change.event,
    'the event',
  );
}

function playerName(
  change: JsonRecord,
  names: Record<string, string>,
  key = 'player_name',
  idKey = 'player_id',
): string {
  const id = text(change[idKey], '');
  return text(change[key] ?? (id ? (names[id] ?? `Player ${id}`) : undefined), 'Unknown player');
}

function formatCourtChange(change: JsonRecord, names: Record<string, string>): string {
  const name = playerName(change, names);
  const session = change.session ?? change.segment_order;
  const label = session === undefined ? 'Session unavailable' : `Session ${text(session)}`;
  const courtLabel = (court: unknown, courts: unknown) => {
    if (Array.isArray(courts) && courts.length > 1)
      return `Courts ${courts.map((value) => text(value)).join(', ')}`;
    if (court == null && (!Array.isArray(courts) || courts.length === 0)) return 'Unassigned';
    return `Court ${text(court ?? (Array.isArray(courts) ? courts[0] : undefined))}`;
  };
  const previous = courtLabel(change.previous_court, change.previous_courts);
  const next = courtLabel(change.new_court, change.new_courts);
  return `${name} — ${label}: ${previous} → ${next}`;
}

function formatRegistrationChange(
  change: JsonRecord,
  entry: AuditEntryLike,
  names: Record<string, string>,
): string {
  const event = eventName(change, entry, names);
  const kind = text(change.change, 'updated');
  const name = playerName(change, names);
  if (kind === 'added') {
    return `Added ${name} to ${event}. Previous registration: none. New registration: ${text(change.new_status, 'status unavailable')}.`;
  }
  if (kind === 'removed') {
    return `Removed ${name} from ${event}. Previous registration: ${text(change.old_status, 'status unavailable')}. New registration: removed.`;
  }
  if (kind === 'replaced') {
    return `Replaced ${playerName(change, names, 'previous_player_name', 'previous_player_id')} with ${name} in ${event}.`;
  }
  if (
    change.old_status !== change.new_status &&
    (change.old_status !== undefined || change.new_status !== undefined)
  ) {
    return `${name}: ${text(change.old_status, 'none')} → ${text(change.new_status, 'none')} in ${event}.`;
  }
  const details = [
    change.old_queue_position !== change.new_queue_position &&
      `waitlist position ${text(change.old_queue_position, 'none')} → ${text(change.new_queue_position, 'none')}`,
    change.old_payment_status !== change.new_payment_status &&
      `payment ${text(change.old_payment_status, 'none')} → ${text(change.new_payment_status, 'none')}`,
  ].filter((item): item is string => typeof item === 'string');
  return `${name}: ${details.join('; ') || 'registration details updated'} in ${event}.`;
}

function fieldDiffLines(value: unknown, target: string, names: Record<string, string>): string[] {
  const changes = record(value);
  if (!changes) return [];
  return Object.entries(changes).flatMap(([field, rawDiff]) => {
    const diff = record(rawDiff);
    if (
      !diff ||
      (!('old' in diff) && !('new' in diff) && !('old_value' in diff) && !('new_value' in diff))
    )
      return [];
    let previous = 'old_value' in diff ? diff.old_value : diff.old;
    let next = 'new_value' in diff ? diff.new_value : diff.new;
    if (/(^|_)(user|player)_id$/i.test(field)) {
      if (typeof previous === 'string') previous = names[previous] ?? `Player ${previous}`;
      if (typeof next === 'string') next = names[next] ?? `Player ${next}`;
    } else if (/event_id$/i.test(field)) {
      if (typeof previous === 'string') previous = names[previous] ?? `Event ${previous}`;
      if (typeof next === 'string') next = names[next] ?? `Event ${next}`;
    }
    return [`${target}: ${title(field)} changed from ${text(previous)} to ${text(next)}.`];
  });
}

export function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    'event_court_assignments.save': 'Court assignments updated',
    'event.registration.created': 'Event registration created',
    'event.registration.withdrawn': 'Event registration withdrawn',
    'event.registration.replaced': 'Event participant replaced',
    'event.registration.admin_added': 'Player added to event',
    'event.registration.admin_removed': 'Player removed from event',
    'auth.sign_in': 'Signed in',
    'auth.sign_out': 'Signed out',
    'auth.sign_up': 'Account created',
    'auth.password_recovery_requested': 'Password recovery requested',
  };
  if (labels[action]) return labels[action];
  const match = action.match(/^([a-z_]+)\.(insert|update|delete)$/);
  if (match) {
    const verb = { insert: 'created', update: 'updated', delete: 'deleted' }[
      match[2] as 'insert' | 'update' | 'delete'
    ];
    return `${title(match[1].replace(/s$/, ''))} ${verb}`;
  }
  return title(action.replaceAll('.', ' '));
}

export function auditChangeLines(
  entry: AuditEntryLike,
  names: Record<string, string> = {},
): string[] {
  const changes = record(entry.changes);
  if (!changes) return [];
  const target = text(changes.target_name ?? changes.entity_name ?? entry.target_table, 'record');
  const courtChanges = Array.isArray(changes.player_changes) ? changes.player_changes : [];
  if (courtChanges.length)
    return courtChanges.map((change) => formatCourtChange(record(change) ?? {}, names));

  const registrations = Array.isArray(changes.affected_players) ? changes.affected_players : [];
  if (registrations.length) {
    return registrations.map((change) =>
      formatRegistrationChange(record(change) ?? {}, entry, names),
    );
  }

  const entities = Array.isArray(changes.entities) ? changes.entities : [];
  if (entities.length) {
    return entities.flatMap((rawEntity) => {
      const entity = record(rawEntity);
      if (!entity) return [];
      const entityName = text(entity.name ?? entity.display_name ?? entity.id ?? target);
      if (entity.type === 'court_assignment') return [formatCourtChange(entity, names)];
      if (entity.type === 'registration') return [formatRegistrationChange(entity, entry, names)];
      const diffs = fieldDiffLines(entity.field_changes ?? entity.changes, entityName, names);
      if (diffs.length) return diffs;
      const operation = text(entity.operation ?? changes.operation, 'updated');
      const values = record(operation === 'deleted' ? entity.old_values : entity.new_values);
      const snapshot = values
        ? Object.entries(values)
            .filter(
              ([key, value]) => !/(^id$|_id$|created_at|updated_at)/i.test(key) && value !== null,
            )
            .slice(0, 8)
            .map(([key, value]) => `${title(key)}: ${text(value)}`)
        : [];
      if (operation === 'created' && snapshot.length)
        return [`Created ${entityName}: ${snapshot.join('; ')}.`];
      if (operation === 'deleted' && snapshot.length)
        return [`Deleted ${entityName}. Previous values: ${snapshot.join('; ')}.`];
      return [`${title(operation)} ${entityName}; field values were not captured.`];
    });
  }

  const fields = fieldDiffLines(changes.field_changes ?? changes.fields, target, names);
  if (fields.length) return fields;

  const operation = text(changes.operation, '');
  if (operation === 'insert' || operation === 'created') {
    return [`Created ${target}; initial field values were not captured in this record.`];
  }
  if (operation === 'delete' || operation === 'deleted') {
    return [`Deleted ${target}; previous field values were not captured in this record.`];
  }
  if (operation === 'added' || operation === 'removed') {
    return [`${title(operation)} ${target}; details were not captured in this record.`];
  }
  if (
    changes.affected_count !== undefined ||
    changes.affected_records !== undefined ||
    changes.sample_record !== undefined
  ) {
    return [
      'Historical change details were not captured; this record only contains an affected-record count or sample.',
    ];
  }
  return [];
}

const SENSITIVE_KEY =
  /(password|token|secret|credential|authorization|service.?role|api.?key|provider.?reference)/i;

export function safeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeAuditDetails);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, safeAuditDetails(item)]),
  );
}
