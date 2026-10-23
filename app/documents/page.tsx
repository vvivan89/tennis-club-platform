import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { DocumentsBrowser } from '@/components/documents-browser';

export default async function DocumentsPage() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/documents');
  const [{ data: profile }, { data: club }] = await Promise.all([
    db.from('profiles').select('role,application_status').eq('id', user.id).maybeSingle(),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  if (profile?.application_status !== 'approved') redirect('/member/dashboard');
  const { data: hasPaidMembership } =
    profile?.role === 'admin' ? { data: true } : await db.rpc('has_ever_paid_membership');
  if (!hasPaidMembership && profile?.role !== 'admin') redirect('/events');
  const { data: docs, error } = await db
    .from('documents')
    .select('id,title,description,storage_path,created_at')
    .order('created_at', { ascending: false });
  const documents = await Promise.all(
    (docs ?? []).map(async (doc) => {
      const { data } = await db.storage
        .from('member-documents')
        .createSignedUrl(doc.storage_path, 60 * 60);
      return { ...doc, downloadUrl: data?.signedUrl ?? null };
    }),
  );
  const clubName = club?.club_name || 'Port Coquitlam Tennis Club';
  const shortName = club?.short_name || 'PCTC';
  const socials = Array.isArray(club?.social_links) ? (club.social_links as { url: string }[]) : [];
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} />
      <div className="page-container flex-1 py-10">
        <p className="eyebrow">Member resources</p>
        <h1 className="section-title">Documents</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Bylaws, meeting minutes, and other important club documents.
        </p>
        {error ? (
          <p role="alert" className="mt-6 text-sm text-destructive">
            Documents could not be loaded. Please try again later.
          </p>
        ) : (
          <DocumentsBrowser
            documents={documents.map((d) => ({ ...d, description: d.description || '' }))}
          />
        )}
      </div>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socials} />
    </main>
  );
}
