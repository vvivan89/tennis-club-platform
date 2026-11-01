import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getClubDisplay } from '@/lib/club-display';
import { newsPathSlug } from '@/lib/news-slug';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { sanitizeHtml } from '@/lib/sanitize-html';

export const dynamic = 'force-dynamic';

type NewsArticle = {
  id: string;
  title: string;
  body: string;
  published_at: string | null;
};

export default async function PublicationPage({
  params: paramsPromise,
}: {
  params: Promise<{ slug: string }>;
}) {
  const params = await paramsPromise;
  const db = await createSupabaseServerClient();
  const [{ data: articleRows, error }, { data: settings }] = await Promise.all([
    db.from('news').select('id,title,body,published_at').eq('published', true),
    db
      .from('club_settings')
      .select('club_name,short_name,contact_email,contact_phone,location_url,social_links')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  if (error) throw new Error(`Could not load this article: ${error.message}`);
  const allArticles = (articleRows ?? []) as NewsArticle[];
  const article = allArticles.find((item) => newsPathSlug(item, allArticles) === params.slug);
  if (!article) notFound();

  const { clubName, shortName, socialLinks } = getClubDisplay(settings);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={clubName} shortName={shortName} active="home" />
      <article className="page-container w-full max-w-4xl flex-1 py-10 sm:py-14">
        <Link
          href="/#news"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> back to home page
        </Link>
        <header className="mb-8 border-b border-border pb-6">
          {article.published_at && (
            <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              {new Intl.DateTimeFormat('en-CA', { dateStyle: 'long' }).format(
                new Date(article.published_at),
              )}
            </p>
          )}
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{article.title}</h1>
        </header>
        <div
          className="prose prose-sm max-w-none break-words text-foreground sm:prose-base"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.body) }}
        />
      </article>
      <SiteFooter clubName={clubName} shortName={shortName} socialLinks={socialLinks} />
    </main>
  );
}
