describe('pipelineConfig: tröskel ur miljön', () => {
  const load = (value: string | undefined): number => {
    const old = process.env.TRIAGE_MIN_SCORE;
    if (value === undefined) delete process.env.TRIAGE_MIN_SCORE; else process.env.TRIAGE_MIN_SCORE = value;
    try {
      let minScore = -1;
      jest.isolateModules(() => { minScore = require('../src/config/pipeline.config').pipelineConfig.triage.minScore; });
      return minScore;
    } finally {
      if (old === undefined) delete process.env.TRIAGE_MIN_SCORE; else process.env.TRIAGE_MIN_SCORE = old;
    }
  };

  it('använder standardvärdet när variabeln saknas, är tom eller inte är ett tal (inte 0, som släpper igenom allt)', () => {
    const fallback = load(undefined);
    expect(fallback).toBeGreaterThan(0);
    expect(load('')).toBe(fallback);
    expect(load('   ')).toBe(fallback);
    expect(load('abc')).toBe(fallback);
  });

  it('läser ett giltigt värde', () => {
    expect(load('55')).toBe(55);
  });
});
