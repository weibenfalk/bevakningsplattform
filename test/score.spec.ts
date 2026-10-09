import { relevance } from '../src/pipeline/score';
import { ScoredArticle } from '../src/types';

const NOW = new Date('2026-10-01T07:00:00+02:00');

const article = (extra: Partial<ScoredArticle> = {}): ScoredArticle => ({
  impact: 50, confidence: 0.8, urgency: 'info', sourceWeight: 1, publishedAt: '2026-10-01T06:00:00+02:00',
  entities: [], isTrending: false, ...extra,
});

describe('relevance (poängformeln)', () => {
  it('använder den högst viktade entiteten, oavsett ordning', () => {
    const low = { id: 'a', watchLevel: 'low' as const };
    const critical = { id: 'b', watchLevel: 'critical' as const };
    expect(relevance(article({ entities: [low, critical] }), NOW))
      .toBe(relevance(article({ entities: [critical, low] }), NOW));
    expect(relevance(article({ entities: [low, critical] }), NOW))
      .toBeGreaterThan(relevance(article({ entities: [low] }), NOW));
  });

  it('en okänd bevakningsnivå ger inte NaN', () => {
    const odd = { id: 'a', watchLevel: 'Hög' as never };
    expect(Number.isFinite(relevance(article({ entities: [odd] }), NOW))).toBe(true);
  });

  it('en högre källvikt ger högre poäng', () => {
    expect(relevance(article({ sourceWeight: 2 }), NOW)).toBeGreaterThan(relevance(article({ sourceWeight: 0.5 }), NOW));
  });

  it('färskheten räknas mot den givna klockan', () => {
    const later = new Date('2026-10-31T07:00:00+02:00');
    expect(relevance(article(), NOW)).toBeGreaterThan(relevance(article(), later));
  });
});
