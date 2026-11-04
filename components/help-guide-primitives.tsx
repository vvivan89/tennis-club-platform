'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Info } from 'lucide-react';

export function Topic({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <article id={id} className="scroll-mt-28 rounded-xl border border-border bg-card p-5 sm:p-7">
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      {intro && <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{intro}</p>}
      <div className="mt-5 space-y-5 text-sm leading-6">{children}</div>
    </article>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-primary">
      {children}
    </ol>
  );
}

export function FieldTable({
  rows,
}: {
  rows: Array<{ field: string; value: string; effect: string }>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Input</th>
            <th className="px-3 py-2.5 font-semibold">What to enter</th>
            <th className="px-3 py-2.5 font-semibold">What it changes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.field} className="align-top">
              <th scope="row" className="px-3 py-3 font-medium">
                {row.field}
              </th>
              <td className="px-3 py-3 text-muted-foreground">{row.value}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-3 text-sm leading-6">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function SectionNav({
  links,
  ariaLabel = 'Help guide contents',
  collapsible = false,
}: {
  links: Array<{ href: string; label: string }>;
  ariaLabel?: string;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = collapsible && links.length > 8;

  return (
    <div>
      <nav
        aria-label={ariaLabel}
        className={`flex flex-wrap gap-2 overflow-hidden ${canCollapse && !expanded ? 'max-h-[4.5rem]' : ''}`}
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {link.label}
          </a>
        ))}
      </nav>
      {canCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-sm font-medium text-primary hover:underline"
        >
          {expanded ? 'View less' : 'View all'}
        </button>
      )}
    </div>
  );
}

export function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
