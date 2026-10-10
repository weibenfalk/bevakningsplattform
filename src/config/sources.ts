import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE_WEIGHTS = Symbol('SOURCE_WEIGHTS');

/** Källvikter ur data/sources.json, per käll-id. En källa som saknas här kan inte poängsättas. */
export function loadSourceWeights(path = join(__dirname, '../../data/sources.json')): Map<string, number> {
  const sources: { id: string; weight: number }[] = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(sources.map((s) => [s.id, s.weight]));
}

export const SOURCE_NAMES = Symbol('SOURCE_NAMES');

/** Källornas namn ur data/sources.json, per käll-id (`articles.source_name` är id:t, till exempel "google_reviews"). */
export function loadSourceNames(path = join(__dirname, '../../data/sources.json')): Map<string, string> {
  const sources: { id: string; name: string }[] = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(sources.map((s) => [s.id, s.name]));
}

/** Källans namn för visning. En okänd källa visas med sitt id, och ingen källa ger `null`. */
export function sourceLabel(names: Map<string, string>, id: string | null): string | null {
  return id === null ? null : (names.get(id) ?? id);
}
