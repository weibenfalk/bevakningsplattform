/** Ett tal ur miljön, eller standardvärdet om det saknas eller inte är ett tal (Number('') är 0, vilket skulle släppa igenom allt). */
const envNumber = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

export const pipelineConfig = {
  triage: {
    batchSize: 20,
    // Gissad tröskel, inte kalibrerad (se "Medvetet bortvalt"). Specen siktar på att cirka 700 råposter ska bli cirka 200 kandidater.
    minScore: envNumber('TRIAGE_MIN_SCORE', 40),
  },
  dedupe: {
    sameStoryThreshold: envNumber('DEDUPE_THRESHOLD', 0.92),
  },
  digest: {
    threshold: 55,
    maxItems: 18,
  },
};
