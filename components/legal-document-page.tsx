import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { ClubSiteFooter } from '@/components/club-site-footer';

export async function renderLegalDocumentPage({
  documentType,
  fallbackTitle,
  fallbackBody,
}: {
  documentType: string;
  fallbackTitle: string;
  fallbackBody: string;
}) {
  const db = await createSupabaseServerClient();
  const [{ data: doc }, { data: club }] = await Promise.all([
    db
      .from('legal_document_versions')
      .select('title,body_html,version,created_at')
      .eq('document_type', documentType)
      .eq('is_current', true)
      .maybeSingle(),
    db.from('club_settings').select('club_name,short_name,social_links').eq('id', 1).maybeSingle(),
  ]);
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader
        clubName={club?.club_name || 'Port Coquitlam Tennis Club'}
        shortName={club?.short_name || 'PCTC'}
      />
      <article className="page-container flex-1 py-10">
        <p className="eyebrow">Legal</p>
        <h1 className="section-title">{doc?.title || fallbackTitle}</h1>
        {doc && (
          <p className="mt-2 text-xs text-muted-foreground">
            Version {doc.version} · Updated {new Date(doc.created_at).toLocaleDateString('en-CA')}
          </p>
        )}
        <div
          className="prose prose-sm mt-6 max-w-3xl dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: doc?.body_html || fallbackBody }}
        />
      </article>
      <ClubSiteFooter club={club} />
    </main>
  );
}
