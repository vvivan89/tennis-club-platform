'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  FileClock,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { actionLabel, auditChangeLines, safeAuditDetails } from '@/lib/audit-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FloatingFeedback } from '@/components/floating-feedback';

type LogMode = 'audit' | 'errors';
type AuditRow = {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name_snapshot?: string | null;
  actor_label: string;
  action: string;
  outcome: string;
  target_table: string | null;
  target_record_id: string | null;
  event_id: string | null;
  route: string | null;
  source: string;
  summary: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  correlation_id?: string | null;
};
type ErrorRow = {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  severity: string;
  source: string;
  error_type: string;
  message: string;
  route: string | null;
  operation: string | null;
  event_id: string | null;
  correlation_id: string | null;
  details: Record<string, unknown>;
};
const PAGE_SIZE = 25;

function collectProfileIds(value: unknown): string[] {
  const ids = new Set<string>();
  function visit(current: unknown) {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (/^(?:user|player|previous_player|replacement_player)_id$/.test(key)) {
        if (typeof item === 'string') ids.add(item);
        if (item && typeof item === 'object') {
          const values = item as Record<string, unknown>;
          for (const value of [values.old_value, values.new_value, values.old, values.new])
            if (typeof value === 'string') ids.add(value);
        }
      }
      visit(item);
    }
  }
  visit(value);
  return [...ids];
}

const inputClass = 'h-10 w-full';

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(value),
  );
}
function cleanSummary(value: string) {
  return value.replace(/\s*\(\d+\s+(?:records?|assignments?)\)\s*$/i, '').trim();
}

export function AuditLogsConsole() {
  const [mode, setMode] = useState<LogMode>('audit');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [severity, setSeverity] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<Array<AuditRow | ErrorRow>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [eventNames, setEventNames] = useState<Record<string, string>>({});

  const load = useCallback(
    async (requestedPage = page) => {
      setLoading(true);
      setError('');
      const db = createSupabaseBrowserClient();
      const table = mode === 'audit' ? 'audit_logs' : 'application_errors';
      let query = db
        .from(table)
        .select('*', { count: 'exact' })
        .order('occurred_at', { ascending: false });
      if (from) query = query.gte('occurred_at', new Date(`${from}T00:00:00`).toISOString());
      if (to)
        query = query.lt(
          'occurred_at',
          new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString(),
        );
      if (source) query = query.eq('source', source);
      if (mode === 'audit') {
        if (action) query = query.ilike('action', `%${action}%`);
        if (outcome) query = query.eq('outcome', outcome);
        if (search.trim())
          query = query.or(
            `summary.ilike.%${search.trim()}%,action.ilike.%${search.trim()}%,target_table.ilike.%${search.trim()}%,target_record_id.ilike.%${search.trim()}%,route.ilike.%${search.trim()}%`,
          );
      } else {
        if (severity) query = query.eq('severity', severity);
        if (search.trim())
          query = query.or(
            `message.ilike.%${search.trim()}%,error_type.ilike.%${search.trim()}%,operation.ilike.%${search.trim()}%,route.ilike.%${search.trim()}%`,
          );
      }
      const {
        data,
        count,
        error: queryError,
      } = await query.range(requestedPage * PAGE_SIZE, requestedPage * PAGE_SIZE + PAGE_SIZE - 1);
      if (queryError) {
        setError(queryError.message);
        setRows([]);
        setTotal(0);
      } else {
        const nextRows = (data ?? []) as Array<AuditRow | ErrorRow>;
        setRows(nextRows);
        setTotal(count ?? 0);
        const eventIds = [
          ...new Set(
            nextRows.map((item) => item.event_id).filter((id): id is string => Boolean(id)),
          ),
        ];
        if (eventIds.length) {
          const { data: events } = await db.from('events').select('id,title').in('id', eventIds);
          setEventNames((current) => ({
            ...current,
            ...Object.fromEntries((events ?? []).map((event) => [event.id, event.title])),
          }));
        }
        const profileIds = [
          ...new Set([
            ...nextRows.map((item) => item.actor_user_id).filter((id): id is string => Boolean(id)),
            ...nextRows.flatMap((item) =>
              mode === 'audit' ? collectProfileIds((item as AuditRow).changes) : [],
            ),
          ]),
        ];
        if (profileIds.length) {
          const { data: profiles } = await db
            .from('profiles')
            .select('id,full_name,email')
            .in('id', profileIds)
            .eq('application_status', 'approved')
            .eq('account_kind', 'member');
          setActorNames(
            Object.fromEntries(
              (profiles ?? []).map((profile) => [
                profile.id,
                profile.full_name || profile.email || profile.id,
              ]),
            ),
          );
        } else setActorNames({});
      }
      setLoading(false);
    },
    [action, from, mode, outcome, page, search, severity, source, to],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);
  function changeMode(next: LogMode) {
    setMode(next);
    setPage(0);
    setAction('');
    setOutcome('');
    setSeverity('');
    setSource('');
    setExpanded(null);
  }
  function resetFilters() {
    setSearch('');
    setAction('');
    setOutcome('');
    setSeverity('');
    setSource('');
    setFrom('');
    setTo('');
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-4">
      <div
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        role="tablist"
        aria-label="Log type"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'audit'}
          onClick={() => changeMode('audit')}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${mode === 'audit' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          <ShieldCheck className="h-4 w-4" /> Audit trail
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'errors'}
          onClick={() => changeMode('errors')}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${mode === 'errors' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          <AlertTriangle className="h-4 w-4" /> Application errors
        </button>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm font-medium lg:col-span-2">
            <span>Search logs</span>
            <span className="relative block">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={
                  mode === 'audit'
                    ? 'Action, summary, record, route…'
                    : 'Message, error type, operation, route…'
                }
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </span>
          </label>
          {mode === 'audit' ? (
            <label className="space-y-1 text-sm font-medium">
              <span>Action contains</span>
              <Input
                className={inputClass}
                placeholder="e.g. registrations"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(0);
                }}
              />
            </label>
          ) : (
            <label className="space-y-1 text-sm font-medium">
              <span>Severity</span>
              <select
                className="form-select h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All severities</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          )}
          {mode === 'audit' && (
            <label className="space-y-1 text-sm font-medium">
              <span>Outcome</span>
              <select
                className="form-select h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All outcomes</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="denied">Denied</option>
                <option value="info">Info</option>
              </select>
            </label>
          )}
          {
            <label className="space-y-1 text-sm font-medium">
              <span>Source</span>
              <select
                className="form-select h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All sources</option>
                <option value="web">Web</option>
                <option value="api">API</option>
                <option value="database">Database</option>
                <option value="background">Background</option>
                <option value="integration">Integration</option>
              </select>
            </label>
          }
          <label className="space-y-1 text-sm font-medium">
            <span>From date</span>
            <Input
              className={inputClass}
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>To date</span>
            <Input
              className={inputClass}
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} matching {mode === 'audit' ? 'audit entries' : 'errors'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetFilters}>
              Clear filters
            </Button>
            <Button variant="outline" onClick={() => void load(page)} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>
      <FloatingFeedback
        error={
          error
            ? `Could not load logs: ${error}. Confirm the audit-log migration has been applied and your account has administrator access.`
            : ''
        }
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Date / time</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Context</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <FileClock className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    No matching records. Try changing the filters.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const isAudit = mode === 'audit';
                const audit = row as AuditRow;
                const err = row as ErrorRow;
                const id = row.id;
                const status = isAudit ? audit.outcome : err.severity;
                const changeLines = isAudit ? auditChangeLines(audit, eventNames) : [];
                return (
                  <tr key={`${mode}-${id}`} className="align-top hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {timestamp(row.occurred_at)}
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      <p className="font-semibold text-foreground">
                        {isAudit ? actionLabel(audit.action) : err.error_type}
                      </p>
                      <p className="mt-1 break-words text-muted-foreground">
                        {isAudit ? cleanSummary(audit.summary) : err.message}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {row.actor_user_id
                          ? (audit.actor_name_snapshot ??
                            actorNames[row.actor_user_id] ??
                            'Loading actor…')
                          : isAudit
                            ? audit.actor_label
                            : 'System / unknown'}
                      </p>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p>
                        {isAudit
                          ? audit.target_table
                            ? audit.target_table.replaceAll('_', ' ')
                            : ''
                          : err.operation || ''}
                      </p>
                      {row.event_id && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {eventNames[row.event_id] || 'Related event'}
                        </p>
                      )}
                      {row.route && (
                        <p className="mt-1 break-all text-xs text-muted-foreground">{row.route}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${status === 'success' ? 'bg-emerald-100 text-emerald-800' : ['critical', 'failure', 'denied'].includes(status) ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded === id}
                        onClick={() => setExpanded(expanded === id ? null : id)}
                      >
                        {expanded === id ? 'Hide' : 'Details'}
                      </Button>
                      {expanded === id && (
                        <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                          role="presentation"
                          onMouseDown={(e) => {
                            if (e.target === e.currentTarget) setExpanded(null);
                          }}
                        >
                          <section
                            role="dialog"
                            aria-modal="true"
                            aria-label="Log entry details"
                            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-card p-5 shadow-xl"
                          >
                            <div className="mb-4 flex items-center justify-between">
                              <h2 className="text-lg font-semibold">
                                {isAudit ? actionLabel(audit.action) : err.error_type}
                              </h2>
                              <Button variant="outline" onClick={() => setExpanded(null)}>
                                Close
                              </Button>
                            </div>
                            <dl className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                                  Timestamp
                                </dt>
                                <dd className="mt-1">{timestamp(row.occurred_at)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                                  Actor
                                </dt>
                                <dd className="mt-1 break-all">
                                  {row.actor_user_id
                                    ? (audit.actor_name_snapshot ??
                                      actorNames[row.actor_user_id] ??
                                      'User')
                                    : isAudit
                                      ? audit.actor_label
                                      : 'System / unknown'}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                                  Route
                                </dt>
                                <dd className="mt-1 break-all">{row.route || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                                  Source
                                </dt>
                                <dd className="mt-1">{row.source}</dd>
                              </div>
                            </dl>
                            <h3 className="mt-5 font-semibold">
                              {isAudit ? 'What changed' : 'Diagnostic details'}
                            </h3>
                            {isAudit ? (
                              <ul className="mt-2 space-y-2 rounded-lg border border-border p-3 text-sm">
                                {changeLines.length ? (
                                  changeLines.map((line, index) => (
                                    <li
                                      key={`${audit.target_record_id ?? audit.event_id ?? id}-${index}`}
                                      className="border-b border-border pb-2 last:border-0 last:pb-0"
                                    >
                                      {line}
                                    </li>
                                  ))
                                ) : (
                                  <li className="text-muted-foreground">
                                    Change details were not captured for this historical entry.
                                  </li>
                                )}
                              </ul>
                            ) : (
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                                {err.message}
                              </p>
                            )}
                            <h4 className="mt-4 text-sm font-semibold">Technical details</h4>
                            <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-xs">
                              {JSON.stringify(
                                isAudit
                                  ? safeAuditDetails({
                                      action: audit.action,
                                      target_table: audit.target_table,
                                      target_record_id: audit.target_record_id,
                                      event: audit.event_id
                                        ? {
                                            id: audit.event_id,
                                            name:
                                              eventNames[audit.event_id] ||
                                              String(
                                                audit.metadata?.event_name ??
                                                  `Event ${audit.event_id}`,
                                              ),
                                          }
                                        : undefined,
                                      actor_user_id: audit.actor_user_id,
                                      actor_name: audit.actor_name_snapshot,
                                      occurred_at: audit.occurred_at,
                                      outcome: audit.outcome,
                                      correlation_id: audit.correlation_id,
                                      route: audit.route,
                                      source: audit.source,
                                      changes: audit.changes,
                                      metadata: audit.metadata,
                                    })
                                  : {
                                      message: err.message,
                                      operation: err.operation,
                                      related_event: err.event_id
                                        ? {
                                            name: eventNames[err.event_id] || 'Related event',
                                            id: err.event_id,
                                          }
                                        : undefined,
                                      correlation_id: err.correlation_id,
                                      details: err.details,
                                    },
                                null,
                                2,
                              )}
                            </pre>
                          </section>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Page {Math.min(page + 1, pages)} of {pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
