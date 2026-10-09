import { Inject, Injectable } from '@nestjs/common';
import { pipelineConfig } from '../config/pipeline.config';
import { LLM, LlmProvider } from '../llm/llm.provider';
import { RawItem } from '../types';

@Injectable()
export class TriageService {
  constructor(@Inject(LLM) private readonly llm: LlmProvider) {}

  /** Billig första sållning på rubrik och ingress innan den dyra berikningen. */
  async filter(items: RawItem[]): Promise<RawItem[]> {
    const kept: RawItem[] = [];
    const { batchSize, minScore } = pipelineConfig.triage;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const scores = await this.score(batch);
      batch.forEach((item, idx) => {
        if (scores[idx] >= minScore) kept.push(item);
      });
    }
    return kept;
  }

  private async score(batch: RawItem[]): Promise<number[]> {
    const raw = await this.llm.complete({
      task: 'triage',
      system: 'Bedöm hur relevant varje text är för koncernen, 0-100. Svara med en JSON-lista med tal.',
      prompt: batch.map((b, i) => `${i}: ${b.title} ${b.text.slice(0, 500)}`).join('\n'),
    });
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(Number) : batch.map(() => 0);
    } catch {
      return batch.map(() => 0);
    }
  }
}
