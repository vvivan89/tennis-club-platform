type SluggableNews = { id: string; title: string };

/** Creates a stable, human-readable URL segment from a news headline. */
export function newsSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100)
      .replace(/_+$/g, '') || 'article'
  );
}

/** Adds a short ID suffix only when multiple published articles share a headline slug. */
export function newsPathSlug(article: SluggableNews, articles: SluggableNews[]): string {
  const base = newsSlug(article.title);
  const duplicates = articles.filter((candidate) => newsSlug(candidate.title) === base);
  return duplicates.length > 1 ? `${base}_${article.id.slice(0, 8)}` : base;
}
