'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Mail, Phone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MemberEditModal, type SuspensionRecord } from '@/components/member-edit-modal';
import { formatPhoneNumber } from '@/lib/format-phone';
type SortKey =
  | 'full_name'
  | 'email'
  | 'phone'
  | 'tennis_skill_level'
  | 'role'
  | 'membership_type'
  | 'payment_status'
  | 'last_played'
  | 'suspension'
  | 'created_at';
export type MemberRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  tennis_skill_level: string | null;
  role: string;
  created_at: string;
  payment_status: string;
  membership_type: string;
  family_members: string[];
  last_played: string | null;
  admin_comment: string;
  suspensions: SuspensionRecord[];
};
const cols: { key: SortKey; label: string }[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'email', label: 'Contacts' },
  { key: 'tennis_skill_level', label: 'Skill rating' },
  { key: 'role', label: 'Role' },
  { key: 'membership_type', label: 'Type' },
  { key: 'last_played', label: 'Last played' },
  { key: 'suspension', label: 'Suspension' },
  { key: 'created_at', label: 'Joined' },
];
function activeSuspension(m: MemberRow) {
  const today = new Date().toISOString().slice(0, 10);
  return m.suspensions.find((s) => !s.cancelled_at && s.starts_on <= today && s.ends_on >= today);
}
function displaySuspension(m: MemberRow) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    activeSuspension(m) ??
    m.suspensions
      .filter((s) => !s.cancelled_at && s.starts_on > today)
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0]
  );
}
export function MembersTable({ initialMembers }: { initialMembers: MemberRow[] }) {
  const [members, setMembers] = useState(initialMembers);
  useEffect(() => setMembers(initialMembers), [initialMembers]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [paidFilter, setPaidFilter] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'full_name', asc: true });
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const filtered = useMemo(
    () =>
      members
        .filter(
          (m) =>
            [m.full_name, m.email, m.phone].some((v) =>
              (v || '').toLowerCase().includes(query.toLowerCase()),
            ) &&
            (roleFilter === 'all' || m.role === roleFilter) &&
            (typeFilter === 'all' || m.membership_type === typeFilter) &&
            (paidFilter === 'all' || m.payment_status === paidFilter),
        )
        .sort((a, b) => {
          const val = (m: MemberRow): string => {
            if (sort.key === 'suspension') {
              const s = displaySuspension(m);
              return s ? `${s.starts_on} ${s.ends_on}` : 'none';
            }
            return String(m[sort.key] ?? '');
          };
          const av = val(a),
            bv = val(b);
          const cmp = ['created_at', 'last_played'].includes(sort.key)
            ? new Date(av || 0).getTime() - new Date(bv || 0).getTime()
            : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          return sort.asc ? cmp : -cmp;
        }),
    [members, query, roleFilter, typeFilter, paidFilter, sort],
  );
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, or phone"
            aria-label="Search members"
            className="max-w-md"
          />
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {members.length} members
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Role
            <select
              className="mt-1 h-10 w-full rounded-md border bg-background px-3"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="all">All roles</option>
              {[...new Set(members.map((m) => m.role).filter(Boolean))].sort().map((v) => (
                <option key={v} value={v} className="capitalize">
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Membership type
            <select
              className="mt-1 h-10 w-full rounded-md border bg-background px-3"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All types</option>
              <option value="single">Single</option>
              <option value="family">Family</option>
              <option value="none">Not assigned</option>
            </select>
          </label>
          <label className="text-sm">
            Paid status
            <select
              className="mt-1 h-10 w-full rounded-md border bg-background px-3"
              value={paidFilter}
              onChange={(e) => setPaidFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-4 py-3 font-medium">
                  <button
                    onClick={() =>
                      setSort((s) => ({ key: c.key, asc: s.key === c.key ? !s.asc : true }))
                    }
                    className="hover:underline"
                  >
                    {c.label}
                    {sort.key === c.key ? (sort.asc ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const suspension = displaySuspension(m);
              const isActive = !!activeSuspension(m);
              const typeLabel =
                m.membership_type === 'family'
                  ? 'Family'
                  : m.membership_type === 'single'
                    ? 'Single'
                    : '—';
              return (
                <tr key={m.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{m.full_name || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-44 flex-col gap-1">
                      <a
                        className="flex items-center gap-2 hover:underline"
                        href={`mailto:${m.email}`}
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{m.email || '—'}</span>
                      </a>
                      {m.phone ? (
                        <a
                          className="flex items-center gap-2 hover:underline"
                          href={`tel:${m.phone}`}
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span>{formatPhoneNumber(m.phone)}</span>
                        </a>
                      ) : (
                        <span className="pl-5 text-muted-foreground">No phone</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{m.tennis_skill_level || '—'}</td>
                  <td className="px-4 py-3 capitalize">{m.role}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        title={
                          m.membership_type === 'family' && m.family_members.length
                            ? `Family members: ${m.family_members.join(', ')}`
                            : undefined
                        }
                        className={
                          m.membership_type === 'family'
                            ? 'cursor-help underline decoration-dotted underline-offset-4'
                            : ''
                        }
                      >
                        {typeLabel}
                      </span>
                      {m.payment_status !== 'paid' && m.membership_type !== 'none' && (
                        <span
                          className="inline-flex"
                          title="Membership is unpaid"
                          aria-label="Membership is unpaid"
                        >
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {m.last_played ? new Date(m.last_played).toLocaleDateString('en-CA') : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {suspension ? (
                      <span
                        className={
                          isActive ? 'font-medium text-destructive' : 'text-muted-foreground'
                        }
                      >
                        {isActive ? 'Active' : 'Scheduled'}: {suspension.starts_on} –{' '}
                        {suspension.ends_on}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {new Date(m.created_at).toLocaleDateString('en-CA')}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(m)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-4 text-sm text-muted-foreground">No matching members found.</p>
        )}
      </div>
      {selected && <MemberEditModal member={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
