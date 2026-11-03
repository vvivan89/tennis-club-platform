'use client';
import Image from 'next/image';
import { TennisLoader } from '@/components/tennis-loader';
import { FormFeedback } from '@/components/form-feedback';
import { SiteFooter } from '@/components/site-footer';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getAdminBrowserClient } from '@/lib/supabase-browser-user';
import { formatPhoneNumber } from '@/lib/format-phone';
import { AdminNav } from '@/components/admin-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Facebook,
  Instagram,
  Linkedin,
  Link as LinkIcon,
  Music2,
  Twitter,
  Youtube,
  Trash2,
  Plus,
  Building2,
  Users,
} from 'lucide-react';
type SocialLink = { url: string };
type UserOption = { id: string; full_name: string; email: string };
type ClubContact = {
  id?: string;
  profile_id: string;
  position: string;
  emails: string[];
  phones: string[];
  is_public: boolean;
  sort_order: number;
};
type Settings = {
  club_name: string;
  short_name: string;
  description: string;
  contact_email: string;
  contact_phone: string;
  location_url: string;
  location_query: string;
  social_links: SocialLink[];
  logo_url: string;
};
const defaults: Settings = {
  club_name: 'Port Coquitlam Tennis Club',
  short_name: 'PCTC',
  description: '',
  contact_email: '',
  contact_phone: '',
  location_url: '',
  location_query: '',
  social_links: [],
  logo_url: '',
};
export default function ClubProfileAdminPage() {
  const router = useRouter();
  const [form, setForm] = useState<Settings>(defaults);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [contacts, setContacts] = useState<ClubContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'contacts'>('info');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'contacts') setActiveTab('contacts');
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      const db = await getAdminBrowserClient(router, '/login?next=/admin/club-profile');
      if (!db) return;
      const [settings, profiles, existing] = await Promise.all([
        db
          .from('club_settings')
          .select(
            'club_name,short_name,description,contact_email,contact_phone,location_url,location_query,social_links,logo_url',
          )
          .eq('id', 1)
          .maybeSingle(),
        db
          .from('profiles')
          .select('id,full_name,email')
          .eq('application_status', 'approved')
          .eq('account_kind', 'member')
          .order('full_name'),
        db
          .from('club_contacts')
          .select('id,profile_id,position,emails,phones,is_public,sort_order')
          .order('sort_order'),
      ]);
      if (active) {
        if (settings.data)
          setForm({
            ...defaults,
            ...settings.data,
            contact_phone: formatPhoneNumber(settings.data.contact_phone),
            social_links: Array.isArray(settings.data.social_links)
              ? settings.data.social_links
              : [],
          });
        if (profiles.data) setUsers(profiles.data);
        if (existing.data)
          setContacts(
            existing.data.map((x) => ({
              ...x,
              emails: Array.isArray(x.emails) ? x.emails : [],
              phones: Array.isArray(x.phones)
                ? x.phones.map((phone: string) => formatPhoneNumber(phone))
                : [],
            })),
          );
        if (settings.error) {
          console.error('[Club profile] Settings load failed', settings.error);
          setError('Could not load club settings. Please try again.');
        }
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [router]);
  function change(key: keyof Settings, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    setError('');
    setMessage('');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      setError('Upload a PNG, JPEG, WebP, or SVG logo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('The logo must be 5 MB or smaller.');
      return;
    }
    setBusy(true);
    const db = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `logo/${Date.now()}-${safeName}`;
    const { error: uploadError } = await db.storage
      .from('club-assets')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      console.error('[Club profile] Logo upload failed', uploadError);
      setError('Could not upload the logo. Please try again.');
      setBusy(false);
      return;
    }
    const { data } = db.storage.from('club-assets').getPublicUrl(path);
    setForm((f) => ({ ...f, logo_url: data.publicUrl }));
    setMessage('Logo uploaded. Save the club profile to publish it.');
    setBusy(false);
  }
  function updateContact(i: number, patch: Partial<ClubContact>) {
    setContacts((cs) => cs.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  }
  async function saveInfo(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const cleaned = form.social_links.map((x) => ({ url: x.url.trim() })).filter((x) => x.url);
    for (const item of cleaned) {
      try {
        const u = new URL(item.url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      } catch {
        setError(`Invalid social media URL: ${item.url}`);
        setBusy(false);
        return;
      }
    }
    if (form.location_url) {
      try {
        const u = new URL(form.location_url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      } catch {
        setError('Enter a valid Google Maps link.');
        setBusy(false);
        return;
      }
    }
    if (!form.location_query.trim() && form.location_url) {
      setError('Enter the club address or place name so the map can be embedded reliably.');
      setBusy(false);
      return;
    }
    const db = createSupabaseBrowserClient();
    const saved = await db
      .from('club_settings')
      .upsert({ ...form, social_links: cleaned, id: 1, updated_at: new Date().toISOString() });
    if (saved.error) {
      console.error('[Club profile] Save failed', saved.error);
      setError('Could not save club information. Please try again.');
      setBusy(false);
      return;
    }
    window.dispatchEvent(new Event('club-logo-updated'));
    setMessage('Club information saved.');
    setBusy(false);
  }
  async function saveContacts(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const normalized = contacts.map((c, i) => ({
      ...c,
      position: c.position.trim(),
      emails: c.emails.map((x) => x.trim()).filter(Boolean),
      phones: c.phones.map((x) => x.trim()).filter(Boolean),
      sort_order: i,
    }));
    if (normalized.some((c) => !c.profile_id || !c.position)) {
      setError(
        'Choose a member and enter a position for each contact row, or remove the incomplete row.',
      );
      setBusy(false);
      return;
    }
    const db = createSupabaseBrowserClient();
    const { data: old } = await db.from('club_contacts').select('id');
    const oldIds = new Set((old ?? []).map((x) => x.id));
    const retainedIds = new Set(normalized.map((x) => x.id).filter(Boolean));
    const deleted = [...oldIds].filter((id) => !retainedIds.has(id));
    if (deleted.length) {
      const result = await db.from('club_contacts').delete().in('id', deleted);
      if (result.error) {
        console.error('[Club profile] Contact deletion failed', result.error);
        setError('Could not save contact details. Please try again.');
        setBusy(false);
        return;
      }
    }
    for (const c of normalized) {
      const row = {
        profile_id: c.profile_id,
        position: c.position,
        emails: c.emails,
        phones: c.phones,
        is_public: c.is_public,
        sort_order: c.sort_order,
        updated_at: new Date().toISOString(),
      };
      const result = c.id
        ? await db.from('club_contacts').update(row).eq('id', c.id)
        : await db.from('club_contacts').insert(row);
      if (result.error) {
        console.error('[Club profile] Contact save failed', result.error);
        setError('Could not save contact details. Please try again.');
        setBusy(false);
        return;
      }
    }
    const { data: reloaded } = await db
      .from('club_contacts')
      .select('id,profile_id,position,emails,phones,is_public,sort_order')
      .order('sort_order');
    if (reloaded) setContacts(reloaded as ClubContact[]);
    setMessage('Contact details saved.');
    setBusy(false);
  }
  function icon(url: string) {
    const u = url.toLowerCase();
    if (/facebook\.com/.test(u)) return <Facebook className="h-4 w-4" />;
    if (/instagram\.com/.test(u)) return <Instagram className="h-4 w-4" />;
    if (/twitter\.com|x\.com/.test(u)) return <Twitter className="h-4 w-4" />;
    if (/youtube\.com|youtu\.be/.test(u)) return <Youtube className="h-4 w-4" />;
    if (/linkedin\.com/.test(u)) return <Linkedin className="h-4 w-4" />;
    if (/tiktok\.com/.test(u)) return <Music2 className="h-4 w-4" />;
    return <LinkIcon className="h-4 w-4" />;
  }
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <AdminNav />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Club administration</p>
        <h1 className="section-title">Club Profile</h1>
        {loading ? (
          <TennisLoader label="Loading club settings" />
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Club profile sections"
              className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'info'}
                onClick={() => {
                  setActiveTab('info');
                  router.replace('/admin/club-profile?tab=info');
                }}
                className={`inline-flex items-center rounded-md border px-4 py-2 text-sm ${activeTab === 'info' ? 'border-primary bg-secondary font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
              >
                <Building2 className="mr-2 h-4 w-4" />
                Club info
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'contacts'}
                onClick={() => {
                  setActiveTab('contacts');
                  router.replace('/admin/club-profile?tab=contacts');
                }}
                className={`inline-flex items-center rounded-md border px-4 py-2 text-sm ${activeTab === 'contacts' ? 'border-primary bg-secondary font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
              >
                <Users className="mr-2 h-4 w-4" />
                Club contacts
              </button>
            </div>
            <div hidden={activeTab !== 'info'}>
              <form onSubmit={saveInfo} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Club information</CardTitle>
                    <CardDescription>
                      Club identity, map location and social links used across the website.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <label className="block space-y-1.5 text-sm font-medium">
                      Club name
                      <Input
                        value={form.club_name}
                        onChange={(e) => change('club_name', e.target.value)}
                        required
                        maxLength={300}
                      />
                    </label>
                    <div className="space-y-2">
                      <label className="block space-y-1.5 text-sm font-medium">
                        Club logo
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={(e) => void uploadLogo(e.target.files?.[0])}
                          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2"
                        />
                      </label>
                      {form.logo_url && (
                        <div className="flex items-center gap-3">
                          <Image
                            src={form.logo_url}
                            alt="Club logo preview"
                            width={64}
                            height={64}
                            unoptimized
                            className="h-16 w-16 rounded-md border border-border object-contain p-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => change('logo_url', '')}
                          >
                            Remove logo
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        PNG, JPEG, WebP, or SVG; maximum 5 MB. The saved logo appears in the site
                        header.
                      </p>
                    </div>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Short name
                      <Input
                        value={form.short_name}
                        onChange={(e) => change('short_name', e.target.value)}
                        required
                        maxLength={40}
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      General contact email
                      <Input
                        type="email"
                        value={form.contact_email}
                        onChange={(e) => change('contact_email', e.target.value)}
                        maxLength={300}
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      General contact phone
                      <Input
                        type="tel"
                        value={form.contact_phone}
                        onChange={(e) => change('contact_phone', e.target.value)}
                        onBlur={() =>
                          setForm((f) => ({
                            ...f,
                            contact_phone: formatPhoneNumber(f.contact_phone),
                          }))
                        }
                        maxLength={80}
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Club address or place name
                      <Input
                        placeholder="e.g. Port Coquitlam Tennis Club, Port Coquitlam, BC"
                        value={form.location_query}
                        onChange={(e) => change('location_query', e.target.value)}
                        maxLength={500}
                      />
                      <span className="block text-xs font-normal text-muted-foreground">
                        Used as the map&apos;s search location. This fixes embeds that fail with
                        short Google Maps share links.
                      </span>
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Google Maps link (optional)
                      <Input
                        type="url"
                        placeholder="https://maps.app.goo.gl/..."
                        value={form.location_url}
                        onChange={(e) => change('location_url', e.target.value)}
                        maxLength={1000}
                      />
                      <span className="block text-xs font-normal text-muted-foreground">
                        Used for the “Open in Google Maps” link; the map itself uses the
                        address/place name above.
                      </span>
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Club description
                      <textarea
                        className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm"
                        value={form.description}
                        onChange={(e) => change('description', e.target.value)}
                        maxLength={5000}
                      />
                    </label>
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold">Social media links</h3>
                        <p className="text-xs text-muted-foreground">
                          Recognized networks display matching icons automatically.
                        </p>
                      </div>
                      {form.social_links.map((item, i) => (
                        <div key={i} className="flex gap-2">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border">
                            {icon(item.url)}
                          </div>
                          <Input
                            type="url"
                            placeholder="https://..."
                            aria-label={`Social media URL ${i + 1}`}
                            value={item.url}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                social_links: f.social_links.map((x, j) =>
                                  i === j ? { url: e.target.value } : x,
                                ),
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Remove social link"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                social_links: f.social_links.filter((_, j) => j !== i),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setForm((f) => ({ ...f, social_links: [...f.social_links, { url: '' }] }))
                        }
                      >
                        Add social link
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <FormFeedback error={error} message={message} />
                <Button type="submit" disabled={busy}>
                  {busy ? <TennisLoader compact label="Saving" /> : 'Save club information'}
                </Button>
              </form>
            </div>
            <div hidden={activeTab !== 'contacts'}>
              <form onSubmit={saveContacts} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Club contacts and executives</CardTitle>
                    <CardDescription>
                      Select existing users, set a position, add multiple emails/phones separated by
                      commas, and choose whether each contact appears publicly. Names and positions
                      always remain visible; when details are not public, only logged-in members
                      with an active paid membership can see the email addresses and phone numbers.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {contacts.map((c, i) => (
                      <div
                        key={c.id ?? `new-${i}`}
                        className="space-y-3 rounded-lg border border-border p-4"
                      >
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-sm font-medium">
                            Member
                            <select
                              value={c.profile_id}
                              onChange={(e) => updateContact(i, { profile_id: e.target.value })}
                              required
                              className="block h-10 w-full rounded-md border border-input bg-background px-3"
                            >
                              <option value="">Select a member…</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name || u.email} ({u.email})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 text-sm font-medium">
                            Position
                            <Input
                              placeholder="e.g. President"
                              value={c.position}
                              onChange={(e) => updateContact(i, { position: e.target.value })}
                              required
                            />
                          </label>
                          <label className="space-y-1 text-sm font-medium">
                            Email addresses
                            <textarea
                              className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm font-normal"
                              placeholder="person@example.com, office@example.com"
                              value={c.emails.join(', ')}
                              onChange={(e) =>
                                updateContact(i, { emails: e.target.value.split(',') })
                              }
                            />
                          </label>
                          <label className="space-y-1 text-sm font-medium">
                            Phone numbers
                            <textarea
                              className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm font-normal"
                              placeholder="604.555.0100, 604.555.0101"
                              value={c.phones.join(', ')}
                              onChange={(e) =>
                                updateContact(i, { phones: e.target.value.split(',') })
                              }
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={c.is_public}
                                onChange={(e) => updateContact(i, { is_public: e.target.checked })}
                              />{' '}
                              Reveal contact information on public Contacts page
                            </label>
                            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                              If unchecked, the person’s name and position remain visible to
                              everyone, but their phone numbers and email addresses are shown only
                              to logged-in members with an active paid membership.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setContacts((cs) => cs.filter((_, j) => i !== j))}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setContacts((cs) => [
                          ...cs,
                          {
                            profile_id: '',
                            position: '',
                            emails: [],
                            phones: [],
                            is_public: false,
                            sort_order: cs.length,
                          },
                        ])
                      }
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add contact
                    </Button>
                  </CardContent>
                </Card>
                <FormFeedback error={error} message={message} />
                <Button type="submit" disabled={busy}>
                  {busy ? <TennisLoader compact label="Saving" /> : 'Save contact details'}
                </Button>
              </form>
            </div>
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
