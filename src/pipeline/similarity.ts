import { pipelineConfig } from '../config/pipeline.config';

/**
 * Cosinuslikhet mellan två vektorer: skalärprodukten delad med produkten av längderna. Resultatet ligger mellan -1 och 1.
 * Räknas på riktigt och antar inte att vektorerna redan har längd 1 (stubbens har det inte, och en annan leverantör
 * kan lämna ut ej normaliserade vektorer). Utan normalisering blir skalärprodukten godtyckligt stor och orelaterade
 * texter räknas som "samma story".
 *
 * En nollvektor, en tom vektor eller ett värde som inte är ett tal ger 0 i stället för NaN.
 * Vektorer med olika längd är ett fel: de kommer från olika modeller och går inte att jämföra.
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`Vektorerna har olika längd (${a.length} och ${b.length}) och går inte att jämföra`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(dot) || !Number.isFinite(denominator) || denominator === 0) return 0;
  // Avrundning kan ge 1,0000000000000002. Håll resultatet inom [-1, 1].
  return Math.max(-1, Math.min(1, dot / denominator));
}

/**
 * Samma story om likheten når tröskeln. Tröskeln är GISSAD och inte kalibrerad (se beslutsloggen):
 * specen kräver kalibrering mot märkt data med under 2 % felaktiga sammanslagningar.
 */
export function isSameStory(a: number[], b: number[]): boolean {
  return similarity(a, b) >= pipelineConfig.dedupe.sameStoryThreshold;
}
