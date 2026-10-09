/**
 * Testerna kör mot en egen databas (`bevakning_test`) på samma Postgres-server som demon, så att `npm test`
 * aldrig tömmer demodatan. Databasen skapas automatiskt (se jest.global-setup.ts).
 */
export const TEST_DATABASE_URL = 'postgres://bevakning:bevakning@localhost:5433/bevakning_test';

/**
 * Testdatabasens URL: `TEST_DATABASE_URL` om den är satt, annars den lokala. `DATABASE_URL` räknas medvetet aldrig,
 * eftersom den kan peka på en databas som inte får tömmas.
 */
export function testDatabaseUrl(env: { TEST_DATABASE_URL?: string; DATABASE_URL?: string } = process.env): string {
  return env.TEST_DATABASE_URL?.trim() || TEST_DATABASE_URL;
}

/** Databasnamnet ur en URL, eller null om URL:en inte går att tolka. */
export function databaseName(url: string | undefined): string | null {
  try {
    return new URL(url ?? '').pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

/** Testerna tömmer tabellerna. Vägra köra mot en databas vars namn inte slutar på `_test`. */
export function assertTestDatabase(url: string | undefined): void {
  const name = databaseName(url);
  if (!name || !/_test$/.test(name)) {
    throw new Error(`Vägrar köra testerna mot databasen "${name ?? url ?? ''}": namnet måste sluta på _test, annars töms riktig data`);
  }
}

/** Servicedatabasen `postgres` på samma server. Där skapas testdatabasen. */
export function adminDatabaseUrl(url: string): string {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
}
