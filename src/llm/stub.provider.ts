import { createHash } from 'node:crypto';
import { Space } from '../types';
import { LlmProvider } from './llm.provider';

const DIMENSIONS = 256;

const bucket = (word: string) =>
  createHash('md5').update(word).digest().readUInt32BE(0) % DIMENSIONS;

/** Deterministisk ersättare för tester och körning utan API-nyckel. */
export class StubProvider implements LlmProvider {
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().split(/\W+/)) {
      if (word) vector[bucket(word)] += 1;
    }
    return vector;
  }

  /**
   * Enkla nyckelord i stället för en modell, så att demon blir förutsägbar:
   * tak-ord ger takvard, fönster- och puts-ord ger fonsterputs, Sydkust och börsnotering ger koncern.
   * Inget av dem ger tom lista, som berikningen då flaggar för granskning.
   */
  async complete(request?: { prompt: string }): Promise<string> {
    return JSON.stringify({
      summary: 'Sammanfattning från stubben.',
      business_areas: stubBusinessAreas(request?.prompt ?? ''),
      categories: ['ovrigt'],
      urgency: 'info',
      impact: 50,
      confidence: 0.8,
    });
  }
}

export function stubBusinessAreas(text: string): Space[] {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const has = (...prefixes: string[]) => words.some((w) => prefixes.some((p) => w.startsWith(p)));
  const areas: Space[] = [];
  if (has('tak')) areas.push('takvard');
  if (has('fönster', 'puts')) areas.push('fonsterputs');
  if (has('sydkust', 'börsnotering')) areas.push('koncern');
  return areas;
}
