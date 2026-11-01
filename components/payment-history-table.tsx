'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPaymentRefundForm } from '@/components/admin-payment-refund-form';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type PaymentRow = {
  id: string;
  provider?: string;
  purpose: string;
  eventName: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  refundedAmountMinor: number;
  proceedsMinor?: number | null;
  createdAt: string;
  succeededAt: string | null;
  userName?: string | null;
  userEmail?: string | null;
  refundable?: boolean;
};

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(minor / 100);
}

function formatPurpose(purpose: string) {
  return purpose
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase());
}

function titleProvider(provider?: string) {
  return (provider || 'stripe').replace(/^\w/, (character) => character.toUpperCase());
}

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toLocaleUpperCase());
}

const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'canceled',
  'partially_refunded',
  'refunded',
] as const;

export function PaymentHistoryTable({
  rows,
  admin = false,
  userId,
}: {
  rows: PaymentRow[];
  admin?: boolean;
  userId?: string;
}) {
  const router = useRouter();
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  useEffect(() => {
    let active = true;
    setRealtimeConnected(false);
    const db = createSupabaseBrowserClient();
    const channel = db
      .channel(`payment-history-live-updates-${userId ?? 'member'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments',
          ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
        },
        () => router.refresh(),
      )
      .subscribe((status) => {
        if (active) setRealtimeConnected(status === 'SUBSCRIBED');
      });
    return () => {
      active = false;
      void db.removeChannel(channel);
    };
  }, [router, userId]);
  useEffect(() => {
    if (realtimeConnected) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [realtimeConnected, router]);
  const [search, setSearch] = useState('');
  const [purpose, setPurpose] = useState('all');
  const [status, setStatus] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const purposeOptions = useMemo(
    () =>
      [
        ...new Set(
          rows.map((row) =>
            row.purpose === 'event_registration'
              ? row.eventName || 'Event Registration'
              : row.purpose === 'tournament_registration'
                ? `${row.eventName || 'Tournament'} — Tournament Registration`
                : formatPurpose(row.purpose),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const purposeLabel =
        row.purpose === 'event_registration'
          ? row.eventName || 'Event Registration'
          : row.purpose === 'tournament_registration'
            ? `${row.eventName || 'Tournament'} — Tournament Registration`
            : formatPurpose(row.purpose);
      if (purpose !== 'all' && purposeLabel !== purpose) return false;
      if (status !== 'all' && row.status !== status) return false;
      if (minAmount !== '' && row.amountMinor < Number(minAmount) * 100) return false;
      if (maxAmount !== '' && row.amountMinor > Number(maxAmount) * 100) return false;
      const date = (admin ? row.createdAt : row.succeededAt || row.createdAt).slice(0, 10);
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      if (admin && term) {
        const haystack =
          `${row.userName ?? ''} ${row.userEmail ?? ''} ${row.eventName ?? ''}`.toLocaleLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, admin, search, purpose, status, minAmount, maxAmount, fromDate, toDate]);

  return (
    <div className="mt-6 space-y-4">
      <div
        className={`grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 ${admin ? 'lg:grid-cols-9' : 'lg:grid-cols-7'}`}
      >
        {admin && (
          <label className="block text-sm lg:col-span-2">
            <span className="mb-1 block text-muted-foreground">Search user or event</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email, event name"
              className="w-full rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Purpose</span>
          <select
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="all">All purposes</option>
            {purposeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Payment status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="all">All statuses</option>
            {PAYMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {formatStatus(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Minimum amount</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={minAmount}
            onChange={(event) => setMinAmount(event.target.value)}
            placeholder="Any"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Maximum amount</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={maxAmount}
            onChange={(event) => setMaxAmount(event.target.value)}
            placeholder="Any"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">From date</span>
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">To date</span>
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setPurpose('all');
              setStatus('all');
              setMinAmount('');
              setMaxAmount('');
              setFromDate('');
              setToDate('');
            }}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Clear filters
          </button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing {filteredRows.length} of {rows.length} payments
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="whitespace-nowrap px-3 py-3">{admin ? 'Created' : 'Date'}</th>
              <th className="px-3 py-3">Purpose</th>
              {admin && <th className="px-3 py-3">User</th>}
              <th className="whitespace-nowrap px-3 py-3">Amount</th>
              {admin && <th className="whitespace-nowrap px-3 py-3">Proceeds</th>}
              <th className="whitespace-nowrap px-3 py-3">Refunded</th>
              <th className="px-3 py-3">Status</th>
              {!admin && <th className="px-3 py-3">Method</th>}
              {!admin && <th className="px-3 py-3">Reference</th>}
              {admin && <th className="min-w-64 px-3 py-3">Refund action</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const remaining = row.amountMinor - row.refundedAmountMinor;
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-3">
                    {new Date(
                      admin ? row.createdAt : row.succeededAt || row.createdAt,
                    ).toLocaleString('en-CA')}
                  </td>
                  <td className="px-3 py-3">
                    <span className="capitalize">{formatPurpose(row.purpose)}</span>
                    {['event_registration', 'tournament_registration'].includes(row.purpose) && (
                      <span className="mt-1 block font-medium text-muted-foreground">
                        {row.eventName || 'Event name unavailable'}
                      </span>
                    )}
                  </td>
                  {admin && (
                    <td className="max-w-56 px-3 py-3">
                      <span className="block font-medium">{row.userName || 'Unknown user'}</span>
                      <span className="mt-1 block break-all text-xs text-muted-foreground">
                        {row.userEmail || 'Email unavailable'}
                      </span>
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-3">
                    {formatMoney(row.amountMinor, row.currency)}
                  </td>
                  {admin && (
                    <td className="whitespace-nowrap px-3 py-3">
                      {row.proceedsMinor === null || row.proceedsMinor === undefined
                        ? '—'
                        : formatMoney(row.proceedsMinor, row.currency)}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-3">
                    {row.refundedAmountMinor
                      ? formatMoney(row.refundedAmountMinor, row.currency)
                      : '—'}
                  </td>
                  <td className="px-3 py-3">{formatStatus(row.status)}</td>
                  {!admin && <td className="px-3 py-3">{titleProvider(row.provider)}</td>}
                  {!admin && (
                    <td className="max-w-48 truncate px-3 py-3 font-mono text-xs">{row.id}</td>
                  )}
                  {admin && (
                    <td className="px-3 py-3">
                      {row.refundable && remaining > 0 ? (
                        <AdminPaymentRefundForm paymentId={row.id} remainingMinor={remaining} />
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {!filteredRows.length && (
              <tr>
                <td
                  colSpan={admin ? 8 : 7}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No payments match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
