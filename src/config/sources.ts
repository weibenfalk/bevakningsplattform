import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE_WEIGHTS = Symbol('SOURCE_WEIGHTS');

/** Källvikter ur data/sources.json, per käll-id. En källa som saknas här kan inte poängsättas. */
export function loadSourceWeights(path = join(__dirname, '../../data/sources.json')): Map<string, number> {
  const sources: { id: string; weight: number }[] = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(sources.map((s) => [s.id, s.weight]));
}
