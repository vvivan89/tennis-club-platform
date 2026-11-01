'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { FormFeedback } from '@/components/form-feedback';
import { AdminSectionTabs } from '@/components/admin-section-tabs';
import { useState, type FormEvent } from 'react';
type DocumentRow = {
  id: string;
  title: string;
  description: string | null;
  storage_path: string;
  created_at: string;
};
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { requireBrowserUser } from '@/lib/supabase-browser-user';
import { AdminNav } from '@/components/admin-nav';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApprovedAdminPage } from '@/hooks/use-approved-admin-page';

export function AdminDocumentsContent({ embedded = false }: { embedded?: boolean }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null);
  async function load() {
    const db = createSupabaseBrowserClient();
    const { data } = await db
      .from('documents')
      .select('id,title,description,created_at,storage_path')
      .order('created_at', { ascending: false });
    setDocuments(data ?? []);
  }
  useApprovedAdminPage('/login?next=/admin/documents?tab=uploaded_documents', () => void load());
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!file || file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Select a PDF file.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('PDF must be 20 MB or smaller.');
      return;
    }
    if (!title.trim()) {
      setError('Enter a document name.');
      return;
    }
    setBusy(true);
    try {
      const { db, user } = await requireBrowserUser();
      const path = `${user.id}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await db.storage
        .from('member-documents')
        .upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await db.from('documents').insert({
        title: title.trim(),
        description: description.trim() || null,
        category: 'general',
        storage_path: path,
        visible_to_members: true,
        uploaded_by: user.id,
        mime_type: 'application/pdf',
        file_size_bytes: file.size,
      });
      if (insertError) {
        await db.storage.from('member-documents').remove([path]);
        throw insertError;
      }
      setTitle('');
      setDescription('');
      setFile(null);
      const input = document.getElementById('document-pdf') as HTMLInputElement | null;
      if (input) input.value = '';
      setMessage('PDF uploaded.');
      await load();
    } catch (e) {
      console.error('[Member documents] PDF upload failed', e);
      setError('Could not upload PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(doc: DocumentRow) {
    const db = createSupabaseBrowserClient();
    setError('');
    const { error: storageError } = await db.storage
      .from('member-documents')
      .remove([doc.storage_path]);
    if (storageError) {
      console.error('[Member documents] Storage deletion failed', storageError);
      setError('Could not delete document. Please try again.');
      return;
    }
    const { error: deleteError } = await db.from('documents').delete().eq('id', doc.id);
    if (deleteError) {
      console.error('[Member documents] Database deletion failed', deleteError);
      setError('Could not delete document. Please try again.');
      return;
    }
    await load();
  }
  return (
    <main
      className={
        embedded
          ? 'w-full bg-background text-foreground'
          : 'flex min-h-screen flex-col bg-background text-foreground'
      }
    >
      {!embedded && <AdminNav />}
      <div className={embedded ? 'w-full' : 'page-container flex-1 py-10'}>
        {!embedded && <AdminSectionTabs section="legal" />}
        <p className="eyebrow">Member resources</p>
        <h1 className="section-title">Documents</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Upload PDF documents for active club members.
        </p>
        <form
          onSubmit={submit}
          className="mt-6 w-full max-w-4xl space-y-4 rounded-xl border border-border p-5 sm:p-6"
        >
          <label className="block space-y-1.5 text-sm font-medium">
            Document name
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={180}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            PDF file
            <input
              id="document-pdf"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const selected = e.target.files?.[0] ?? null;
                setFile(selected);
                if (selected) {
                  setTitle(selected.name.replace(/\.pdf$/i, ''));
                  setError('');
                }
              }}
              required
              className="block w-full text-sm"
            />
            <span className="text-xs font-normal text-muted-foreground">
              PDF only; maximum 20 MB.
            </span>
          </label>
          <FormFeedback error={error} message={message} />
          <Button type="submit" disabled={busy}>
            {busy ? <TennisLoader compact label="Uploading" /> : 'Upload PDF'}
          </Button>
        </form>
        <section className="mt-8 w-full max-w-4xl">
          <h2 className="text-lg font-semibold">Uploaded documents</h2>
          <div className="mt-3 divide-y divide-border rounded-xl border border-border">
            {documents.map((doc) => (
              <div key={doc.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <h3 className="font-medium">{doc.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{doc.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Uploaded {new Date(doc.created_at).toLocaleDateString('en-CA')}
                  </p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(doc)}>
                  Delete
                </Button>
              </div>
            ))}
            {!documents.length && (
              <p className="p-4 text-sm text-muted-foreground">No documents uploaded yet.</p>
            )}
          </div>
        </section>
      </div>
      {!embedded && <SiteFooter />}
      {deleteTarget && (
        <ConfirmDialog
          open
          title="Delete document?"
          description={`Delete “${deleteTarget.title}”? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void remove(target);
          }}
        />
      )}
    </main>
  );
}
