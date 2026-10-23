'use client';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';

type DocumentItem = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  downloadUrl: string | null;
};
export function DocumentsBrowser({ documents }: { documents: DocumentItem[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'date' | 'name'>('date');
  const filtered = useMemo(
    () =>
      documents
        .filter((d) => d.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .sort((a, b) =>
          sort === 'name'
            ? a.title.localeCompare(b.title)
            : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [documents, query, sort],
  );
  return (
    <>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 space-y-1 text-sm font-medium">
          Search by name
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'date' | 'name')}
            className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-56"
          >
            <option value="date">Upload date (newest first)</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>
      </div>
      <div className="mt-4 divide-y divide-border rounded-xl border border-border">
        {filtered.map((doc) => (
          <article
            key={doc.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <h2 className="font-semibold">{doc.title}</h2>
              {doc.description && (
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                  {doc.description}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Uploaded {new Date(doc.created_at).toLocaleDateString('en-CA')}
              </p>
            </div>
            {doc.downloadUrl ? (
              <a
                className="inline-flex h-9 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
                href={doc.downloadUrl}
                target="_blank"
                rel="noreferrer"
                download
              >
                Download PDF
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">Download unavailable</span>
            )}
          </article>
        ))}
        {!filtered.length && (
          <p className="p-5 text-sm text-muted-foreground">
            {documents.length
              ? 'No documents match your search.'
              : 'No documents are available yet.'}
          </p>
        )}
      </div>
    </>
  );
}
