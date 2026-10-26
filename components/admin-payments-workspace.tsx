'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Download, Search, X, Save } from 'lucide-react';
import { AdminPaymentRefundForm } from '@/components/admin-payment-refund-form';
import { AdminManualPaymentRefundForm } from '@/components/admin-manual-payment-refund-form';
import { ConfirmDialog } from '@/components/confirm-dialog';

type Row = {
  id: string;
  provider: string;
  purpose: string;
  eventName: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  manualReviewStatus: string | null;
  refundedAmountMinor: number;
  feeMinor: number | null;
  proceedsMinor: number | null;
  createdAt: string;
  succeededAt: string | null;
  userName: string | null;
  userEmail: string | null;
  refundable: boolean;
};
type Settings = {
  interac_enabled: boolean;
  interac_recipient_email: string;
  interac_instructions: string;
};
const money = (n: number, currency = 'cad') =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency.toUpperCase() }).format(
    n / 100,
  );
const title = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function downloadCsv(rows: Row[], label: string) {
  const fields: Array<[string, (r: Row) => string | number | null]> = [
    ['Payment ID', (r) => r.id],
    ['Created At', (r) => r.createdAt],
    ['Provider', (r) => r.provider],
    ['Member Name', (r) => r.userName],
    ['Member Email', (r) => r.userEmail],
    ['Purpose', (r) => r.purpose],
    ['Event', (r) => r.eventName],
    ['Amount Minor', (r) => r.amountMinor],
    ['Currency', (r) => r.currency],
    ['Status', (r) => r.status],
    ['Manual Review Status', (r) => r.manualReviewStatus],
    ['Refunded Minor', (r) => r.refundedAmountMinor],
    ['Stripe Fee Minor', (r) => r.feeMinor],
    ['Proceeds Minor', (r) => r.proceedsMinor],
    ['Succeeded At', (r) => r.succeededAt],
  ];
  const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [
    fields.map(([name]) => quote(name)).join(','),
    ...rows.map((r) => fields.map(([, get]) => quote(get(r))).join(',')),
  ].join('\r\n');
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pctc-payments-${label}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div
      className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-12"
      aria-label="Monthly payment totals chart"
    >
      {values.map((v, i) => (
        <div key={labels[i]} className="flex min-w-0 flex-col items-center gap-2">
          <div className="flex h-40 w-full items-end rounded bg-muted">
            <div
              title={money(v)}
              className="w-full rounded-t bg-primary"
              style={{ height: `${Math.max(v ? 3 : 0, (v / max) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{labels[i]}</span>
          <span className="text-center text-[10px]">{v ? money(v) : '—'}</span>
        </div>
      ))}
    </div>
  );
}
export function AdminPaymentsWorkspace({
  rows,
  initialSettings,
}: {
  rows: Row[];
  initialSettings: Settings;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const validTabs = ['report', 'stripe', 'interac'] as const;
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState<'report' | 'stripe' | 'interac'>(
    validTabs.includes(urlTab as (typeof validTabs)[number])
      ? (urlTab as (typeof validTabs)[number])
      : 'report',
  );
  const [settings, setSettings] = useState(initialSettings);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [query, setQuery] = useState('');
  const [paymentPurpose, setPaymentPurpose] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [reviewDialog, setReviewDialog] = useState<{
    row: Row;
    action: 'confirm' | 'reject';
  } | null>(null);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    setTab(
      validTabs.includes(urlTab as (typeof validTabs)[number])
        ? (urlTab as (typeof validTabs)[number])
        : 'report',
    );
  }, [urlTab]);
  function selectTab(nextTab: 'report' | 'stripe' | 'interac') {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [reportScope, setReportScope] = useState('all');
  const [reportProvider, setReportProvider] = useState('all');
  const years = [
    ...new Set(rows.map((r) => new Date(r.succeededAt || r.createdAt).getFullYear().toString())),
  ]
    .sort()
    .reverse();
  if (!years.includes(reportYear)) years.unshift(reportYear);
  const reportRows = useMemo(
    () =>
      rows.filter((r) => {
        if (new Date(r.succeededAt || r.createdAt).getFullYear().toString() !== reportYear)
          return false;
        if (reportProvider !== 'all' && r.provider !== reportProvider) return false;
        if (reportScope === 'membership' && r.purpose !== 'membership') return false;
        if (reportScope.startsWith('event:') && r.eventName !== reportScope.slice(6)) return false;
        return ['succeeded', 'partially_refunded', 'refunded'].includes(r.status);
      }),
    [rows, reportYear, reportProvider, reportScope],
  );
  const netFor = (r: Row) =>
    r.proceedsMinor ?? r.amountMinor - r.refundedAmountMinor - (r.feeMinor ?? 0);
  const monthValues = Array.from({ length: 12 }, (_, i) =>
    reportRows
      .filter((r) => new Date(r.succeededAt || r.createdAt).getMonth() === i)
      .reduce((sum, r) => sum + netFor(r), 0),
  );
  const total = reportRows.reduce((sum, r) => sum + netFor(r), 0);
  const gross = reportRows.reduce((sum, r) => sum + r.amountMinor, 0);
  const refunded = reportRows.reduce((sum, r) => sum + r.refundedAmountMinor, 0);
  const fees = reportRows.reduce((sum, r) => sum + (r.feeMinor ?? 0), 0);
  const scopes = [
    ...new Set(
      rows
        .filter((r) => r.purpose === 'event_registration' && r.eventName)
        .map((r) => r.eventName as string),
    ),
  ].sort();
  const purposeOptions = [
    ...new Set(
      rows
        .filter((r) => r.provider === tab)
        .map((r) =>
          r.purpose === 'event_registration'
            ? r.eventName || 'Event registration'
            : title(r.purpose),
        ),
    ),
  ].sort();
  const statusOptions = [
    ...new Set(
      rows
        .filter((r) => r.provider === tab)
        .map((r) =>
          ['refunded', 'partially_refunded'].includes(r.status)
            ? r.status
            : r.manualReviewStatus || r.status,
        ),
    ),
  ].sort();
  const tableRows = rows
    .filter((r) => r.provider === tab)
    .filter((r) =>
      `${r.userName ?? ''} ${r.userEmail ?? ''} ${r.eventName ?? ''} ${r.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .filter(
      (r) =>
        paymentPurpose === 'all' ||
        (r.purpose === 'event_registration'
          ? r.eventName || 'Event registration'
          : title(r.purpose)) === paymentPurpose,
    )
    .filter(
      (r) =>
        paymentStatus === 'all' ||
        (['refunded', 'partially_refunded'].includes(r.status)
          ? r.status
          : r.manualReviewStatus || r.status) === paymentStatus,
    )
    .filter((r) => !fromDate || r.createdAt.slice(0, 10) >= fromDate)
    .filter((r) => !toDate || r.createdAt.slice(0, 10) <= toDate)
    .filter((r) => minAmount === '' || r.amountMinor >= Number(minAmount) * 100)
    .filter((r) => maxAmount === '' || r.amountMinor <= Number(maxAmount) * 100);
  async function saveSettings() {
    setSettingsBusy(true);
    setSettingsMessage('');
    try {
      const response = await fetch('/api/admin/payments/interac-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.interac_enabled,
          recipientEmail: settings.interac_recipient_email,
          instructions: settings.interac_instructions,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save settings.');
      setSettingsMessage('Interac settings saved.');
      router.refresh();
    } catch (e) {
      setSettingsMessage(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setSettingsBusy(false);
    }
  }
  async function review(row: Row, action: 'confirm' | 'reject') {
    setActionError('');
    setReviewDialog({ row, action });
  }
  async function performReview() {
    if (!reviewDialog) return;
    const { row, action } = reviewDialog;
    setBusyId(row.id);
    try {
      const response = await fetch('/api/admin/payments/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: row.id, action, note: reviewNote[row.id] || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Review action failed.');
      setReviewNote((v) => ({ ...v, [row.id]: '' }));
      setReviewDialog(null);
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Review action failed.');
    } finally {
      setBusyId('');
    }
  }
  return (
    <div className="mt-6 space-y-6">
      {actionError && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {actionError}
        </p>
      )}
      <div
        role="tablist"
        aria-label="Payment administration"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {(['report', 'stripe', 'interac'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => selectTab(t)}
            className={`rounded-md px-4 py-2 text-sm font-medium ${tab === t ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}
          >
            {t === 'report' ? 'Report' : title(t)}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadCsv(rows, 'all')}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <Download size={16} /> Export all
          </button>
          {tab !== 'report' && (
            <button
              onClick={() =>
                downloadCsv(
                  rows.filter((r) => r.provider === tab),
                  tab,
                )
              }
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <Download size={16} /> Export {title(tab)}
            </button>
          )}
        </div>
      </div>
      {tab === 'report' ? (
        <section className="space-y-5">
          <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
            <label className="text-sm">
              Year
              <select
                value={reportYear}
                onChange={(e) => setReportYear(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background p-2"
              >
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Payment category
              <select
                value={reportScope}
                onChange={(e) => setReportScope(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background p-2"
              >
                <option value="all">All payments</option>
                <option value="membership">Memberships</option>
                {scopes.map((name) => (
                  <option key={name} value={`event:${name}`}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Payment method
              <select
                value={reportProvider}
                onChange={(e) => setReportProvider(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background p-2"
              >
                <option value="all">All methods</option>
                <option value="stripe">Stripe</option>
                <option value="interac">Interac</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Net proceeds / estimated receipts', total],
              ['Gross payments', gross],
              ['Refunds', refunded],
              ['Stripe fees', fees],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{money(Number(value))}</p>
              </div>
            ))}
          </div>
          <section className="rounded-xl border border-border p-5">
            <h2 className="font-semibold">Monthly net receipts · {reportYear}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Successful payments grouped by payment success date. Stripe uses recorded proceeds
              where available; other totals are estimated from gross less refunds and known fees.
            </p>
            <Bars
              values={monthValues}
              labels={[
                'Jan',
                'Feb',
                'Mar',
                'Apr',
                'May',
                'Jun',
                'Jul',
                'Aug',
                'Sep',
                'Oct',
                'Nov',
                'Dec',
              ]}
            />
          </section>
          <section className="rounded-xl border border-border p-5">
            <h2 className="font-semibold">Breakdown by purpose</h2>
            <div className="mt-3 space-y-3">
              {(
                Object.entries(
                  reportRows.reduce<Record<string, number>>((acc, r) => {
                    const k =
                      r.purpose === 'event_registration'
                        ? r.eventName || 'Event registration'
                        : title(r.purpose);
                    acc[k] = (acc[k] || 0) + netFor(r);
                    return acc;
                  }, {}),
                ) as Array<[string, number]>
              )
                .sort((a, b) => b[1] - a[1])
                .map(([name, amount]) => (
                  <div key={name}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span>{name}</span>
                      <strong>{money(amount)}</strong>
                    </div>
                    <div className="mt-1 h-2 rounded bg-muted">
                      <div
                        className="h-2 rounded bg-primary"
                        style={{ width: `${Math.max(0, (amount / Math.max(1, total)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              {!reportRows.length && (
                <p className="text-sm text-muted-foreground">
                  No successful payments match this report.
                </p>
              )}
            </div>
            <button
              onClick={() => downloadCsv(reportRows, `report-${reportYear}`)}
              className="mt-5 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <Download size={16} /> Export report
            </button>
          </section>
        </section>
      ) : (
        <section className="space-y-4">
          {tab === 'interac' && (
            <section className="rounded-xl border border-border p-5">
              <h2 className="text-lg font-semibold">Interac e-Transfer instructions</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These details are shown to members when they choose Interac. Keep Interac disabled
                until the recipient and instructions are ready.
              </p>
              <div className="mt-4 grid gap-4">
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.interac_enabled}
                    onChange={(e) =>
                      setSettings((v) => ({ ...v, interac_enabled: e.target.checked }))
                    }
                  />{' '}
                  Enable Interac payments
                </label>
                <label className="text-sm">
                  Recipient email
                  <input
                    type="email"
                    value={settings.interac_recipient_email}
                    onChange={(e) =>
                      setSettings((v) => ({ ...v, interac_recipient_email: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                    maxLength={254}
                  />
                </label>
                <label className="text-sm">
                  Instructions
                  <textarea
                    value={settings.interac_instructions}
                    onChange={(e) =>
                      setSettings((v) => ({ ...v, interac_instructions: e.target.value }))
                    }
                    rows={4}
                    maxLength={5000}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                    placeholder="Include any transfer message, auto-deposit details, or other payment instructions."
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    disabled={settingsBusy}
                    onClick={() => void saveSettings()}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    <Save size={16} />
                    {settingsBusy ? 'Saving…' : 'Save instructions'}
                  </button>
                  {settingsMessage && (
                    <span role="status" className="text-sm text-muted-foreground">
                      {settingsMessage}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}
          <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm lg:col-span-2">
              <span className="mb-1 block text-muted-foreground">
                Search member, event, or payment ID
              </span>
              <span className="relative block">
                <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, email, event, payment ID"
                  className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3"
                />
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Purpose</span>
              <select
                value={paymentPurpose}
                onChange={(e) => setPaymentPurpose(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="all">All purposes</option>
                {purposeOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Payment status</span>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {title(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Minimum amount ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="Any"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Maximum amount ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="Any"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">From date</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">To date</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setPaymentPurpose('all');
                  setPaymentStatus('all');
                  setFromDate('');
                  setToDate('');
                  setMinAmount('');
                  setMaxAmount('');
                }}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Clear filters
              </button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Showing {tableRows.length} {tab === 'stripe' ? 'Stripe' : 'Interac'} transactions.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="whitespace-nowrap px-3 py-3">Created</th>
                  <th className="px-3 py-3">Purpose</th>
                  <th className="px-3 py-3">Member</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Refunded</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="min-w-64 px-3 py-3">{tab === 'stripe' ? 'Refund' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-3">
                      {new Date(row.createdAt).toLocaleString('en-CA')}
                    </td>
                    <td className="px-3 py-3">
                      {row.purpose === 'event_registration'
                        ? row.eventName || 'Event registration'
                        : title(row.purpose)}
                      <span className="mt-1 block max-w-48 break-all font-mono text-[10px] text-muted-foreground">
                        {row.id}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block">{row.userName || 'Unknown user'}</span>
                      <span className="break-all text-xs text-muted-foreground">
                        {row.userEmail || 'Email unavailable'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {money(row.amountMinor, row.currency)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {row.refundedAmountMinor ? money(row.refundedAmountMinor, row.currency) : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {title(
                        ['refunded', 'partially_refunded'].includes(row.status)
                          ? row.status
                          : row.manualReviewStatus || row.status,
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {tab === 'stripe' ? (
                        row.refundable ? (
                          <AdminPaymentRefundForm
                            paymentId={row.id}
                            remainingMinor={row.amountMinor - row.refundedAmountMinor}
                          />
                        ) : (
                          '—'
                        )
                      ) : ['submitted', 'investigating'].includes(row.manualReviewStatus || '') ? (
                        <div className="min-w-64 space-y-2">
                          <textarea
                            aria-label={`Review note for ${row.id}`}
                            value={reviewNote[row.id] || ''}
                            onChange={(e) =>
                              setReviewNote((v) => ({ ...v, [row.id]: e.target.value }))
                            }
                            placeholder="Internal note; required for rejection"
                            rows={2}
                            className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              title="Confirm payment"
                              aria-label="Confirm payment"
                              disabled={busyId === row.id}
                              onClick={() => void review(row, 'confirm')}
                              className="rounded-md border border-green-600 p-2 text-green-700 disabled:opacity-50"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              title="Reject payment"
                              aria-label="Reject payment"
                              disabled={busyId === row.id || !(reviewNote[row.id] || '').trim()}
                              onClick={() => void review(row, 'reject')}
                              className="rounded-md border border-destructive p-2 text-destructive disabled:opacity-50"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      ) : row.provider === 'interac' &&
                        ['succeeded', 'partially_refunded'].includes(row.status) &&
                        row.manualReviewStatus === 'confirmed' &&
                        row.amountMinor > row.refundedAmountMinor ? (
                        <AdminManualPaymentRefundForm
                          paymentId={row.id}
                          remainingMinor={row.amountMinor - row.refundedAmountMinor}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {!tableRows.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <ConfirmDialog
        open={!!reviewDialog}
        title={
          reviewDialog?.action === 'reject' ? 'Reject Interac payment?' : 'Confirm Interac payment?'
        }
        description={
          reviewDialog?.action === 'reject'
            ? 'Reject this Interac payment request? A reason is required.'
            : `Confirm receipt of ${reviewDialog ? money(reviewDialog.row.amountMinor, reviewDialog.row.currency) : ''} from ${reviewDialog?.row.userName || reviewDialog?.row.userEmail || 'this member'}? This marks the payment as paid and fulfills the associated membership or event registration.`
        }
        confirmLabel={reviewDialog?.action === 'reject' ? 'Reject payment' : 'Confirm payment'}
        destructive={reviewDialog?.action === 'reject'}
        busy={!!busyId}
        onCancel={() => {
          if (!busyId) setReviewDialog(null);
        }}
        onConfirm={() => void performReview()}
      />
    </div>
  );
}
