'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { AdminSectionTabs } from '@/components/admin-section-tabs';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { AdminNav } from '@/components/admin-nav';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/rich-text-editor';
import { AdminDocumentsContent } from '@/components/admin-documents-content';

type DocType = 'membership_waiver' | 'terms_of_use' | 'disclaimer';
type LegalVersion = {
  id: string;
  document_type: DocType;
  version: number;
  title: string;
  body_html: string;
  is_current: boolean;
  created_at: string;
};
const tabs: { id: DocType; label: string }[] = [
  { id: 'membership_waiver', label: 'Membership waiver' },
  { id: 'terms_of_use', label: 'Terms of use' },
  { id: 'disclaimer', label: 'Disclaimer' },
];
export default function AdminLegalPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DocType | 'uploaded_documents'>('membership_waiver');
  const [versions, setVersions] = useState<LegalVersion[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = useMemo(
    () =>
      activeTab === 'uploaded_documents'
        ? undefined
        : versions.find((v) => v.document_type === activeTab && v.is_current),
    [versions, activeTab],
  );
  async function load() {
    const db = createSupabaseBrowserClient();
    const { data, error } = await db
      .from('legal_document_versions')
      .select('*')
      .order('version', { ascending: false });
    if (error) {
      console.error('[Legal documents] Load failed', error);
      setError('Could not load legal documents. Please try again.');
      return;
    }
    setVersions((data ?? []) as LegalVersion[]);
  }
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'membership_waiver' || tab === 'terms_of_use' || tab === 'disclaimer')
      setActiveTab(tab);
    else if (tab === 'uploaded_documents') setActiveTab('uploaded_documents');
  }, []);
  useEffect(() => {
    let alive = true;
    const db = createSupabaseBrowserClient();
    (async () => {
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) {
        router.replace('/login?next=/admin/documents');
        return;
      }
      const { data: profile } = await db
        .from('profiles')
        .select('role,application_status')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.role !== 'admin' || profile?.application_status !== 'approved') {
        router.replace('/member/dashboard');
        return;
      }
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [router]);
  useEffect(() => {
    if (activeTab === 'uploaded_documents') return;
    setTitle(current?.title ?? (tabs.find((t) => t.id === activeTab)?.label || ''));
    setBody(
      current?.body_html ??
        '<h2>Placeholder</h2><p>Replace this placeholder with the document text reviewed and approved by the club.</p>',
    );
    setMessage('');
  }, [current?.id, activeTab]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (activeTab === 'uploaded_documents') return;
    setError('');
    setMessage('');
    if (!title.trim() || !body.trim()) {
      setError('Enter a document title and text.');
      return;
    }
    setBusy(true);
    try {
      const db = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) throw new Error('Sign in again.');
      const maxVersion = Math.max(
        0,
        ...versions.filter((v) => v.document_type === activeTab).map((v) => v.version),
      );
      const { error: archiveError } = await db
        .from('legal_document_versions')
        .update({ is_current: false })
        .eq('document_type', activeTab)
        .eq('is_current', true);
      if (archiveError) throw archiveError;
      const { error: insertError } = await db.from('legal_document_versions').insert({
        document_type: activeTab,
        version: maxVersion + 1,
        title: title.trim(),
        body_html: body,
        created_by: user.id,
        is_current: true,
      });
      if (insertError) throw insertError;
      await load();
      setMessage(`Saved as version ${maxVersion + 1}. Previous versions have been preserved.`);
    } catch (e) {
      console.error('[Legal documents] Save failed', e);
      setError('Could not save legal document. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const oldVersions =
    activeTab === 'uploaded_documents'
      ? []
      : versions.filter((v) => v.document_type === activeTab && !v.is_current);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <AdminSectionTabs section="legal" />
        {activeTab !== 'uploaded_documents' && (
          <>
            <p className="eyebrow">Administration</p>
            <h1 className="section-title">
              {tabs.find((t) => t.id === activeTab)?.label || 'Documents'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Edit the current{' '}
              {tabs.find((t) => t.id === activeTab)?.label.toLowerCase() || 'document'} and preserve
              each published version.
            </p>
          </>
        )}
        {activeTab === 'uploaded_documents' ? (
          <AdminDocumentsContent embedded />
        ) : (
          <>
            <form
              onSubmit={save}
              className="mt-5 max-w-4xl space-y-4 rounded-xl border border-border p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  Current version{current ? ` · v${current.version}` : ''}
                </h2>
                {current && (
                  <span className="text-xs text-muted-foreground">
                    Last saved {new Date(current.created_at).toLocaleString('en-CA')}
                  </span>
                )}
              </div>
              <label className="block space-y-1.5 text-sm font-medium">
                Document title
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={180}
                />
              </label>
              <div>
                <p className="mb-1.5 text-sm font-medium">Document text</p>
                <RichTextEditor value={body} onChange={setBody} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {message && (
                <p role="status" className="text-sm">
                  {message}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? <TennisLoader compact label="Saving" /> : 'Save new version'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Saving creates a new version; it does not overwrite the prior document.
              </p>
            </form>
            <section className="mt-8 max-w-4xl">
              <h2 className="text-lg font-semibold">Previous versions ({oldVersions.length})</h2>
              <div className="mt-3 space-y-2">
                {oldVersions.map((v) => (
                  <details key={v.id} className="rounded-lg border border-border">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                      Version {v.version} · {new Date(v.created_at).toLocaleString('en-CA')} ·{' '}
                      {v.title}
                    </summary>
                    <div className="border-t border-border p-4">
                      <div
                        className="prose prose-sm max-w-none dark:prose-invert"
                        dangerouslySetInnerHTML={{ __html: v.body_html }}
                      />
                    </div>
                  </details>
                ))}
                {!oldVersions.length && (
                  <p className="text-sm text-muted-foreground">No previous versions yet.</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
