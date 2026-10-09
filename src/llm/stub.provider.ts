import { createHash } from 'node:crypto';
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

  async complete(): Promise<string> {
    return JSON.stringify({
      summary: 'Sammanfattning från stubben.',
      business_areas: [],
      urgency: 'info',
      impact: 50,
      confidence: 0.8,
    });
  }
}
