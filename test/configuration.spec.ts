import { loadConfiguration, loadPipelineConfig } from '../src/config/configuration';

describe('loadConfiguration: alla inställningar läses på ett ställe', () => {
  it('ger standardvärden för en tom miljö', () => {
    expect(loadConfiguration({})).toEqual({
      server: { port: 3000, host: '127.0.0.1' },
      databaseUrl: 'postgres://bevakning:bevakning@localhost:5433/bevakning',
      adminUserIds: [],
      pipelineNow: '2026-10-01T07:00:00+02:00',
    });
  });

  it.each([
    ['PORT', { PORT: '8080' }, (c: ReturnType<typeof loadConfiguration>) => c.server.port, 8080],
    ['PORT som inte är ett giltigt portnummer', { PORT: '70000' }, (c: ReturnType<typeof loadConfiguration>) => c.server.port, 3000],
    ['HOST', { HOST: '0.0.0.0' }, (c: ReturnType<typeof loadConfiguration>) => c.server.host, '0.0.0.0'],
    ['DATABASE_URL', { DATABASE_URL: 'postgres://x/y' }, (c: ReturnType<typeof loadConfiguration>) => c.databaseUrl, 'postgres://x/y'],
    ['PIPELINE_NOW', { PIPELINE_NOW: '2026-10-03T07:00:00+02:00' }, (c: ReturnType<typeof loadConfiguration>) => c.pipelineNow, '2026-10-03T07:00:00+02:00'],
    ['PIPELINE_NOW som är tom', { PIPELINE_NOW: '  ' }, (c: ReturnType<typeof loadConfiguration>) => c.pipelineNow, '2026-10-01T07:00:00+02:00'],
    ['HOST som är tom (annars binder servern mot alla gränssnitt)', { HOST: '' }, (c: ReturnType<typeof loadConfiguration>) => c.server.host, '127.0.0.1'],
    ['HOST som bara är blanksteg', { HOST: '  ' }, (c: ReturnType<typeof loadConfiguration>) => c.server.host, '127.0.0.1'],
  ])('%s', (_namn, env, pick, förväntat) => {
    expect(pick(loadConfiguration(env))).toBe(förväntat);
  });

  it('delar ADMIN_USER_IDS vid komma och trimmar blanksteg och tomma poster', () => {
    expect(loadConfiguration({ ADMIN_USER_IDS: ' u-mikael, u-annan ,,' }).adminUserIds).toEqual(['u-mikael', 'u-annan']);
  });

  it('har ingen egen kopia av pipelinens trösklar (de läses via pipelineConfig)', () => {
    expect(loadConfiguration({})).not.toHaveProperty('pipeline');
  });

  it('kräver DATABASE_URL i produktion', () => {
    expect(() => loadConfiguration({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });
});

describe('loadPipelineConfig: trösklarna', () => {
  it('ger standardvärden för en tom miljö', () => {
    expect(loadPipelineConfig({})).toEqual({
      triage: { batchSize: 20, minScore: 40 },
      dedupe: { sameStoryThreshold: 0.92 },
      retention: { days: 90 },
      digest: { threshold: 55, maxItems: 18 },
    });
  });

  it.each([
    ['TRIAGE_MIN_SCORE', { TRIAGE_MIN_SCORE: '55' }, (c: ReturnType<typeof loadPipelineConfig>) => c.triage.minScore, 55],
    ['DEDUPE_THRESHOLD', { DEDUPE_THRESHOLD: '0.8' }, (c: ReturnType<typeof loadPipelineConfig>) => c.dedupe.sameStoryThreshold, 0.8],
  ])('%s', (_namn, env, pick, förväntat) => {
    expect(pick(loadPipelineConfig(env))).toBe(förväntat);
  });
});
