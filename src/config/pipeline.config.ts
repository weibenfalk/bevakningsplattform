export const pipelineConfig = {
  triage: {
    batchSize: 20,
    minScore: Number(process.env.TRIAGE_MIN_SCORE ?? 0),
  },
  dedupe: {
    sameStoryThreshold: Number(process.env.DEDUPE_THRESHOLD ?? 0.92),
  },
  digest: {
    threshold: 55,
    maxItems: 18,
  },
};
