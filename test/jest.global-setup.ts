import knex from 'knex';
import { adminDatabaseUrl, assertTestDatabase, databaseName, testDatabaseUrl } from './test-database';

/** Skapar testdatabasen om den saknas. Körs en gång före alla tester. Tabellerna skapas av testhjälparna (migrationerna). */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);
  const name = databaseName(url)!;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Ogiltigt namn på testdatabasen: ${name}`);

  const admin = knex({ client: 'pg', connection: adminDatabaseUrl(url) });
  try {
    const exists = await admin.raw('select 1 from pg_database where datname = ?', [name]);
    if (exists.rows.length === 0) await admin.raw(`create database "${name}"`);
  } catch (err) {
    throw new Error(`Kunde inte nå Postgres för att skapa testdatabasen "${name}". Är databasen igång? Kör: npm run db:up\n${(err as Error).message}`);
  } finally {
    await admin.destroy();
  }
}
