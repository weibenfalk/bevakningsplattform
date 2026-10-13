describe('pipelineConfig: tröskel ur miljön', () => {
  const load = (value: string | undefined): number => {
    const old = process.env.TRIAGE_MIN_SCORE;
    if (value === undefined) delete process.env.TRIAGE_MIN_SCORE; else process.env.TRIAGE_MIN_SCORE = value;
    try {
      let minScore = -1;
      jest.isolateModules(() => { minScore = require('../src/config/configuration').pipelineConfig.triage.minScore; });
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

  it('läser miljön när trösklarna används och inte när modulen importeras (en .env läses in efter importen)', () => {
    const old = process.env.TRIAGE_MIN_SCORE;
    delete process.env.TRIAGE_MIN_SCORE;
    try {
      jest.isolateModules(() => {
        const { pipelineConfig } = require('../src/config/configuration');
        process.env.TRIAGE_MIN_SCORE = '61'; // som när ConfigModule har läst in .env
        expect(pipelineConfig.triage.minScore).toBe(61);
      });
    } finally {
      if (old === undefined) delete process.env.TRIAGE_MIN_SCORE; else process.env.TRIAGE_MIN_SCORE = old;
    }
  });
});
