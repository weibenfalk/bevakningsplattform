import { LOCAL_DATABASE_URL } from '../src/config/configuration';
import { adminDatabaseUrl, assertTestDatabase, TEST_DATABASE_URL, testDatabaseUrl } from './test-database';
import { closeTestingApp, createTestingApp, testKnex } from './helpers';

describe('testdatabasen', () => {
  it('TEST_DATABASE_URL kan ersätta den, men DATABASE_URL räknas aldrig (den kan peka på något som inte är ett test)', () => {
    expect(testDatabaseUrl({})).toBe(TEST_DATABASE_URL);
    expect(testDatabaseUrl({ DATABASE_URL: 'postgres://u:p@prod.example:5432/bevakning' })).toBe(TEST_DATABASE_URL);
    expect(testDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@ci:5432/ci_test' })).toBe('postgres://u:p@ci:5432/ci_test');
    expect(testDatabaseUrl({ TEST_DATABASE_URL: '  ' })).toBe(TEST_DATABASE_URL);
  });

  it('assertTestDatabase godtar bara databaser vars namn slutar på _test', () => {
    expect(() => assertTestDatabase('postgres://u:p@h:5432/bevakning_test')).not.toThrow();
    for (const bad of ['postgres://u:p@h:5432/bevakning', 'postgres://u:p@h:5432/bevakning_test_old', 'postgres://u:p@h:5432/', undefined, '', 'inte en url']) {
      expect(() => assertTestDatabase(bad)).toThrow(/_test/);
    }
  });

  it('adminDatabaseUrl pekar på servicedatabasen på samma server', () => {
    expect(adminDatabaseUrl('postgres://u:p@h:5433/bevakning_test')).toBe('postgres://u:p@h:5433/postgres');
  });
});

describe('testerna körs mot testdatabasen', () => {
  afterEach(closeTestingApp);

  it('den anslutna databasen är bevakning_test', async () => {
    await createTestingApp();
    const { rows } = await testKnex().raw('select current_database() as name');
    expect(rows[0].name).toMatch(/_test$/);
    expect(rows[0].name).toBe(new URL(process.env.DATABASE_URL!).pathname.slice(1));
  });

  it('createTestingApp vägrar tömma en databas som inte är en testdatabas', async () => {
    const old = process.env.DATABASE_URL;
    process.env.DATABASE_URL = LOCAL_DATABASE_URL; // utvecklingsdatabasen, där demodatan ligger
    try {
      await expect(createTestingApp()).rejects.toThrow(/_test/);
    } finally {
      process.env.DATABASE_URL = old;
    }
  });
});
