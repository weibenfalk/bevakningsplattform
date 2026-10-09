import { pipelineConfig } from '../config/pipeline.config';

/**
 * Leverantörens embeddings är normaliserade till längd 1,
 * så skalärprodukten är cosinuslikheten.
 */
export function similarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function isSameStory(a: number[], b: number[]): boolean {
  return similarity(a, b) >= pipelineConfig.dedupe.sameStoryThreshold;
}
