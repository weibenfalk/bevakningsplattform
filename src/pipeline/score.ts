import { ScoredArticle, WatchLevel } from '../types';

const ENTITY_WEIGHT: Record<WatchLevel, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function relevance(a: ScoredArticle, now: Date): number {
  const ageHours = (now.getTime() - Date.parse(a.publishedAt)) / 36e5;
  const freshness = clamp(100 - (Math.max(0, ageHours - 24) / (13 * 24)) * 100, 0, 100);

  // Den högst viktade entiteten räknas, oavsett ordning. En okänd bevakningsnivå väger 0 och ger aldrig NaN.
  const entityWeight = Math.max(0, ...a.entities.map((e) => ENTITY_WEIGHT[e.watchLevel] ?? 0));

  let r =
    0.4 * a.impact +
    0.25 * entityWeight +
    0.2 * a.sourceWeight * 50 +
    0.15 * freshness;

  if (a.urgency === 'akut') r *= 1.4;
  if (a.isTrending) r *= 1.25;
  if (a.isFollowUp) r *= 0.6;
  if (a.confidence < 0.5) r *= 0.5;

  return Math.round(r);
}
