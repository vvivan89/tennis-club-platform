'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { FloatingFeedback } from '@/components/floating-feedback';
import { AdminSectionTabs } from '@/components/admin-section-tabs';
import { SiteFooter } from '@/components/site-footer';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getAdminBrowserClient, requireBrowserUser } from '@/lib/supabase-browser-user';
import { AdminNav } from '@/components/admin-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RichTextEditor } from '@/components/rich-text-editor';
import { AdminGalleryContent } from '@/components/admin-gallery-content';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { sanitizeHtml } from '@/lib/sanitize-html';

type NewsItem = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  published_at: string | null;
  created_at?: string;
};
type EmailItem = {
  id: string;
  subject: string;
  body_html: string;
  recipient_group: string;
  sent_count: number;
  failed_count: number;
  sent_at: string;
};
const recipientLabel: Record<string, string> = {
  all: 'All approved members',
  active_members: 'Active members',
  admins: 'Administrators',
  organizers: 'Organizers',
  newsletter: 'Newsletter subscribers',
};
export default function WebsiteAdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'news' | 'announcements' | 'gallery'>('news');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteNewsId, setDeleteNewsId] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailGroup, setEmailGroup] = useState('all');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailConfirmCount, setEmailConfirmCount] = useState<number | null>(null);
  async function loadEmailHistory() {
    try {
      const response = await fetch('/api/admin/email-history');
      const result = await response.json();
      if (response.ok) setEmails(result.items ?? []);
    } catch {
      /* History will be refreshed on the next load. */
    }
  }
  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    setActiveTab(
      requestedTab === 'announcements'
        ? 'announcements'
        : requestedTab === 'gallery'
          ? 'gallery'
          : 'news',
    );
    let active = true;
    async function load() {
      const db = await getAdminBrowserClient(router, '/login?next=/admin/website');
      if (!db) return;
      const { data, error } = await db
        .from('news')
        .select('id,title,body,published,published_at,created_at')
        .order('created_at', { ascending: false });
      if (active) {
        if (error) {
          console.error('[Website admin] News load failed', error);
          setError('Could not load website news. Please try again.');
        }
        setItems(data ?? []);
        setLoading(false);
        void loadEmailHistory();
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [router]);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { db, user } = await requireBrowserUser('Please sign in again.');
      const { data, error } = await db
        .from('news')
        .insert({ title: title.trim(), body: body.trim(), published: false, created_by: user.id })
        .select('id,title,body,published,published_at,created_at')
        .single();
      if (error) throw error;
      setItems([data, ...items]);
      setTitle('');
      setBody('');
      setMessage('Website news draft created.');
    } catch (e) {
      console.error('[Website admin] News creation failed', e);
      setError('Could not create news item. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(item: NewsItem) {
    setError('');
    setMessage('');
    const published = !item.published;
    const { error } = await createSupabaseBrowserClient()
      .from('news')
      .update({
        published,
        published_at: published ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);
    if (error) {
      console.error('[Website admin] News update failed', error);
      setError('Could not update website news. Please try again.');
      return;
    }
    setItems(
      items.map((x) =>
        x.id === item.id
          ? { ...x, published, published_at: published ? new Date().toISOString() : null }
          : x,
      ),
    );
    setMessage(
      published
        ? 'News published on the main website.'
        : 'Website news unpublished. Email announcements are managed separately.',
    );
  }
  async function remove(id: string) {
    const { error } = await createSupabaseBrowserClient().from('news').delete().eq('id', id);
    if (error) {
      console.error('[Website admin] News deletion failed', error);
      setError('Could not delete website news. Please try again.');
      return;
    }
    setItems(items.filter((x) => x.id !== id));
    setMessage('Publication deleted.');
  }
  async function postAnnouncement(extra: Record<string, unknown>) {
    const response = await fetch('/api/admin/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: emailSubject, html: emailBody, group: emailGroup, ...extra }),
    });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  }
  function failEmail(response: Response, result: { error?: string }) {
    console.error('[Website admin] Email send failed', { status: response.status, result });
    setError(
      response.status >= 400 && response.status < 500 && result.error
        ? result.error
        : 'Could not send email. Please try again.',
    );
  }
  async function previewEmail(e: FormEvent) {
    e.preventDefault();
    setEmailBusy(true);
    setError('');
    setMessage('');
    try {
      const { response, result } = await postAnnouncement({ preview: true });
      if (!response.ok) return failEmail(response, result);
      if (!result.recipientCount) {
        setError('This group has no recipients with an email address.');
        return;
      }
      setEmailConfirmCount(result.recipientCount);
    } catch (e) {
      console.error('[Website admin] Email preview failed', e);
      setError('Could not send email. Please try again.');
    } finally {
      setEmailBusy(false);
    }
  }
  async function sendEmail() {
    setEmailConfirmCount(null);
    setEmailBusy(true);
    setError('');
    setMessage('');
    try {
      const { response, result } = await postAnnouncement({});
      if (!response.ok) return failEmail(response, result);
      setMessage(`Email announcement sent: ${result.sent} successful, ${result.failed} failed.`);
      setEmailSubject('');
      setEmailBody('');
      await loadEmailHistory();
    } catch (e) {
      console.error('[Website admin] Email send request failed', e);
      setError('Could not send email. Please try again.');
    } finally {
      setEmailBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <FloatingFeedback error={error} message={message} />
      <div className="page-container flex-1 py-10">
        <AdminSectionTabs section="publications" />
        <p className="eyebrow">Website content management</p>
        <h1 className="section-title">Publications</h1>
        {activeTab === 'news' && (
          <section>
            <Card>
              <CardHeader>
                <CardTitle>Publish news on the main page</CardTitle>
                <p className="text-sm text-muted-foreground">
                  These items appear in the website’s Latest News section. Publishing does not send
                  an email.
                </p>
              </CardHeader>
              <CardContent>
                <form onSubmit={add} className="space-y-4">
                  <label className="block space-y-1.5 text-sm font-medium">
                    Headline
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      maxLength={160}
                    />
                  </label>
                  <div className="space-y-1.5 text-sm font-medium">
                    <span>News content</span>
                    <RichTextEditor value={body} onChange={setBody} />
                  </div>
                  <Button disabled={busy}>
                    {busy ? <TennisLoader compact label="Saving" /> : 'Save website news draft'}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <div className="mt-5">
              <h2 className="mb-3 text-lg font-semibold">Website news history</h2>
              {loading ? (
                <TennisLoader label="Loading website content" />
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{item.title}</h3>
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                              {item.published ? 'Published on website' : 'Draft / unpublished'}
                            </span>
                          </div>
                          {item.published_at && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Published {new Date(item.published_at).toLocaleString('en-CA')}
                            </p>
                          )}
                          <div
                            className="prose prose-sm mt-2 max-w-none text-muted-foreground"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.body) }}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => void toggle(item)}>
                            {item.published ? 'Unpublish' : 'Publish'}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteNewsId(item.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {!items.length && (
                    <p className="text-sm text-muted-foreground">No website news items yet.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
        {activeTab === 'gallery' && <AdminGalleryContent embedded />}
        {activeTab === 'announcements' && (
          <section>
            <Card>
              <CardHeader>
                <CardTitle>Send an email announcement</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Send a separate email to a selected recipient group. This does not publish content
                  to the website.
                </p>
              </CardHeader>
              <CardContent>
                <form onSubmit={previewEmail} className="space-y-4">
                  <label className="block space-y-1.5 text-sm font-medium">
                    Recipient group
                    <select
                      value={emailGroup}
                      onChange={(e) => setEmailGroup(e.target.value)}
                      className="block h-10 w-full rounded-md border border-input bg-background px-3"
                    >
                      <option value="all">All approved members (ignores email preferences)</option>
                      <option value="newsletter">Newsletter subscribers</option>
                      <option value="active_members">Active members</option>
                      <option value="admins">Administrators</option>
                      <option value="organizers">Organizers</option>
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-sm font-medium">
                    Email subject
                    <Input
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      required
                      maxLength={180}
                    />
                  </label>
                  <div className="space-y-1.5 text-sm font-medium">
                    <span>Email content</span>
                    <RichTextEditor value={emailBody} onChange={setEmailBody} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only approved members are emailed. All groups except Newsletter subscribers
                    ignore individual email preferences.
                  </p>
                  <Button disabled={emailBusy}>
                    {emailBusy ? (
                      <TennisLoader compact label="Sending" />
                    ) : (
                      'Send email announcement'
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <div className="mt-5">
              <h2 className="mb-3 text-lg font-semibold">Sent email announcement history</h2>
              {emails.length ? (
                <div className="space-y-3">
                  {emails.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{item.subject}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(item.sent_at).toLocaleString('en-CA')} ·{' '}
                              {recipientLabel[item.recipient_group] || item.recipient_group}
                            </p>
                          </div>
                          <div className="text-right text-sm">
                            <p className="font-medium">{item.sent_count} sent</p>
                            <p className="text-xs text-muted-foreground">
                              {item.failed_count} failed
                            </p>
                          </div>
                        </div>
                        <div
                          className="prose prose-sm mt-3 max-w-none text-muted-foreground"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.body_html) }}
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No email announcements have been recorded yet. New sends will appear here.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
      <SiteFooter />
      <ConfirmDialog
        open={emailConfirmCount !== null}
        title="Send email announcement?"
        description={
          emailGroup === 'all'
            ? `This will email all ${emailConfirmCount} approved members, including those who have opted out of newsletters.`
            : `This will email ${emailConfirmCount} recipient${emailConfirmCount === 1 ? '' : 's'}.`
        }
        confirmLabel="Send"
        onCancel={() => setEmailConfirmCount(null)}
        onConfirm={() => void sendEmail()}
      />
      {deleteNewsId && (
        <ConfirmDialog
          open
          title="Delete website news item?"
          description="This item will be permanently deleted."
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleteNewsId(null)}
          onConfirm={() => {
            const id = deleteNewsId;
            setDeleteNewsId(null);
            void remove(id);
          }}
        />
      )}
    </main>
  );
}
