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
  async complete(request?: { task?: string; system?: string; prompt: string }): Promise<string> {
    // Triage: stubben kan inte bedöma relevans, så alla får samma neutrala poäng (över tröskeln). Gäller bara stubben.
    if (request?.task === 'triage') {
      return JSON.stringify(Array((request.prompt.match(/<artikel /g) ?? []).length).fill(50));
    }
    return JSON.stringify({
      summary: 'Sammanfattning från stubben.',
      business_areas: stubBusinessAreas(request?.prompt ?? ''),
      categories: ['ovrigt'],
      urgency: 'info',
      impact: stubImpact(request?.prompt ?? ''),
      confidence: 0.8,
    });
  }
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
const hasPrefix = (text: string, ...prefixes: string[]) => words(text).some((w) => prefixes.some((p) => w.startsWith(p)));

/**
 * Påverkan (0–100) efter nyckelord, på samma sätt som arbetsytan: konkurs, rotavdrag, Arbetsmiljöverket och
 * börsnotering ger hög påverkan och allt annat 50. GÄLLER BARA STUBBEN. Det är en ersättare som gör demon och
 * testerna förutsägbara och ingen bedömning. Riktig påverkan sätts av modellen (0–100).
 */
export function stubImpact(text: string): number {
  return hasPrefix(text, 'konkurs', 'rotavdrag', 'arbetsmiljöverket', 'börsnotering') ? 85 : 50;
}

export function stubBusinessAreas(text: string): Space[] {
  const areas: Space[] = [];
  if (hasPrefix(text, 'tak')) areas.push('takvard');
  if (hasPrefix(text, 'fönster', 'puts')) areas.push('fonsterputs');
  if (hasPrefix(text, 'sydkust', 'börsnotering')) areas.push('koncern');
  return areas;
}
