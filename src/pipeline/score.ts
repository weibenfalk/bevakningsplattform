import { ScoredArticle, WatchLevel } from '../types';

const ENTITY_WEIGHT: Record<WatchLevel, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export interface ScoreComponent {
  key: 'impact' | 'entity' | 'source' | 'freshness';
  label: string;
  /** Värdet på skalan 0–100 (källvikten är omräknad: vikt × 50). */
  input: number;
  weight: number;
  /** `input × weight`, ej avrundat. */
  points: number;
}

export interface ScoreFactor {
  key: 'akut' | 'trend' | 'uppföljning' | 'låg säkerhet';
  label: string;
  multiplier: number;
}

/** Hur poängen räknades fram. Sparas när poängen räknas ut (`articles.score_breakdown`) och räknas aldrig om vid läsning. */
export interface ScoreBreakdown {
  components: ScoreComponent[];
  /** Summan av delarna, före faktorerna. */
  base: number;
  /** Bara de faktorer som gällde. */
  factors: ScoreFactor[];
  score: number;
}

/** Specens formel, steg för steg. `relevance` är samma sak utan uppdelningen. */
export function scoreBreakdown(a: ScoredArticle, now: Date): ScoreBreakdown {
  const ageHours = (now.getTime() - Date.parse(a.publishedAt)) / 36e5;
  const freshness = clamp(100 - (Math.max(0, ageHours - 24) / (13 * 24)) * 100, 0, 100);

  // Den högst viktade entiteten räknas, oavsett ordning. En okänd bevakningsnivå väger 0 och ger aldrig NaN.
  const entityWeight = Math.max(0, ...a.entities.map((e) => ENTITY_WEIGHT[e.watchLevel] ?? 0));

  const component = (key: ScoreComponent['key'], label: string, input: number, weight: number): ScoreComponent =>
    ({ key, label, input, weight, points: input * weight });
  const components = [
    component('impact', 'Påverkan', a.impact, 0.4),
    component('entity', 'Entitetsvikt', entityWeight, 0.25),
    component('source', 'Källvikt', a.sourceWeight * 50, 0.2),
    component('freshness', 'Färskhet', freshness, 0.15),
  ];
  const base = components.reduce((sum, c) => sum + c.points, 0);

  const factors: ScoreFactor[] = [];
  if (a.urgency === 'akut') factors.push({ key: 'akut', label: 'Akut', multiplier: 1.4 });
  if (a.isTrending) factors.push({ key: 'trend', label: 'Trend', multiplier: 1.25 });
  if (a.isFollowUp) factors.push({ key: 'uppföljning', label: 'Uppföljning', multiplier: 0.6 });
  if (a.confidence < 0.5) factors.push({ key: 'låg säkerhet', label: 'Låg säkerhet', multiplier: 0.5 });

  return { components, base, factors, score: Math.round(factors.reduce((r, f) => r * f.multiplier, base)) };
}

export const relevance = (a: ScoredArticle, now: Date): number => scoreBreakdown(a, now).score;
