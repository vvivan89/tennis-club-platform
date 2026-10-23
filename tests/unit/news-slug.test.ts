import { describe, expect, it } from 'vitest';
import { newsPathSlug, newsSlug } from '../../lib/news-slug';

describe('news URL helpers', () => {
  it('normalizes punctuation, accents, and ampersands', () => {
    expect(newsSlug('Été & Tennis: What’s New?')).toBe('ete_and_tennis_what_s_new');
  });

  it('uses article as a fallback for empty titles', () => {
    expect(newsSlug('!!!')).toBe('article');
  });

  it('adds an ID suffix only when title slugs collide', () => {
    const first = { id: '12345678-aaaa', title: 'Club Update' };
    const second = { id: '87654321-bbbb', title: 'Club Update' };
    expect(newsPathSlug(first, [first])).toBe('club_update');
    expect(newsPathSlug(first, [first, second])).toBe('club_update_12345678');
  });
});
