import { LOCAL_DATABASE_URL, resolveDatabaseUrl } from '../src/config/database';
import { knexProvider } from '../src/db/knex.provider';
import { assertDemoDatabase } from '../scripts/db';

describe('resolveDatabaseUrl', () => {
  it('använder DATABASE_URL när den är satt', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://u:p@db.example:5432/x', NODE_ENV: 'production' }))
      .toBe('postgres://u:p@db.example:5432/x');
  });

  it('faller tillbaka på den lokala Docker-databasen utanför produktion', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(resolveDatabaseUrl({ NODE_ENV })).toBe(LOCAL_DATABASE_URL);
    }
    expect(resolveDatabaseUrl({ DATABASE_URL: '  ' })).toBe(LOCAL_DATABASE_URL);
  });

  it('kräver DATABASE_URL i produktion, så att servern aldrig tyst pratar med fel databas', () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => resolveDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});

describe('knexProvider', () => {
  it('får sin anslutning ur resolveDatabaseUrl, så att `npm start` utan DATABASE_URL når databasen', () => {
    const old = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const knex = knexProvider.useFactory();
      // Knex tolkar strängen till ett objekt.
      expect((knex.client.config as { connection: unknown }).connection).toMatchObject({
        host: 'localhost', port: '5433', user: 'bevakning', database: 'bevakning',
      });
      return knex.destroy();
    } finally {
      process.env.DATABASE_URL = old;
    }
  });
});

describe('assertDemoDatabase: demon tömmer tabellerna och körs bara mot den lokala demodatabasen', () => {
  it.each([
    [{ DATABASE_URL: 'postgres://u:p@localhost:5433/bevakning' }],
    [{ DATABASE_URL: 'postgres://u:p@localhost:5433/bevakning', NODE_ENV: 'development' }],
  ])('godkänner %j', (env) => {
    expect(() => assertDemoDatabase(env)).not.toThrow();
  });

  it.each([
    ['en annan databas', { DATABASE_URL: 'postgres://u:p@db.example:5432/bevakning_prod' }],
    ['produktion', { DATABASE_URL: 'postgres://u:p@localhost:5433/bevakning', NODE_ENV: 'production' }],
    ['en testdatabas (den hör till testerna)', { DATABASE_URL: 'postgres://u:p@localhost:5433/bevakning_test' }],
    ['en URL som inte går att tolka', { DATABASE_URL: 'inte en url' }],
    ['ingen URL alls', {}],
  ])('vägrar %s', (_namn, env) => {
    expect(() => assertDemoDatabase(env)).toThrow(/demon/i);
  });
});
