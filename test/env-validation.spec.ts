import { validateEnv } from '../src/config/configuration';

describe('validateEnv: fel i miljön stoppar starten med ett tydligt fel', () => {
  it('godtar en tom miljö utanför produktion (standardvärdena gäller)', () => {
    expect(() => validateEnv({})).not.toThrow();
  });

  it.each([
    ['PIPELINE_NOW som inte är ett datum', { PIPELINE_NOW: 'igår' }, /PIPELINE_NOW/],
    ['DATABASE_URL saknas i produktion', { NODE_ENV: 'production' }, /DATABASE_URL/],
  ])('%s', (_namn, env, fel) => {
    expect(() => validateEnv(env)).toThrow(fel);
  });

  it('godtar ett giltigt datum med tidszon', () => {
    expect(() => validateEnv({ PIPELINE_NOW: '2026-10-03T07:00:00+02:00' })).not.toThrow();
  });

  it('returnerar miljön oförändrad', () => {
    const env = { ADMIN_USER_IDS: 'u-mikael' };
    expect(validateEnv(env)).toBe(env);
  });
});
