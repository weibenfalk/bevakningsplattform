import knex, { Knex } from 'knex';
import { LOCAL_DATABASE_URL } from '../src/config/database';

/** Samma databas som docker-compose.yml startar, om inget annat anges. */
process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;

export const db = (): Knex => knex({ client: 'pg', connection: process.env.DATABASE_URL });

/** Databasen som demon får tömma: den lokala demodatabasen och inget annat. */
const DEMO_DATABASE = 'bevakning';

/**
 * Demon kör TRUNCATE. Vägra allt utom den lokala demodatabasen, och produktion, så att en felpekad `DATABASE_URL`
 * aldrig tömmer riktig data (testerna har samma skydd, se test/test-database.ts).
 */
export function assertDemoDatabase(env: { DATABASE_URL?: string; NODE_ENV?: string } = process.env): void {
  let name: string | null = null;
  try {
    name = new URL(env.DATABASE_URL ?? '').pathname.replace(/^\//, '') || null;
  } catch {
    // name förblir null
  }
  if (env.NODE_ENV === 'production' || name !== DEMO_DATABASE) {
    throw new Error(`Vägrar köra demon mot databasen "${name ?? env.DATABASE_URL ?? ''}": demon tömmer tabellerna och körs bara mot "${DEMO_DATABASE}" utanför produktion`);
  }
}
