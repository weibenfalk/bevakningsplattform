/** Samma databas som docker-compose.yml startar. Bara för lokal körning. */
export const LOCAL_DATABASE_URL = 'postgres://bevakning:bevakning@localhost:5433/bevakning';

/**
 * Anslutningssträngen till databasen. `DATABASE_URL` om den är satt. Utanför produktion används den lokala
 * Docker-databasen. I produktion krävs variabeln, så att servern aldrig tyst pratar med en annan databas än den avsedda.
 */
export function resolveDatabaseUrl(env: { DATABASE_URL?: string; NODE_ENV?: string } = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (url) return url;
  if (env.NODE_ENV === 'production') throw new Error('DATABASE_URL måste vara satt i produktion');
  return LOCAL_DATABASE_URL;
}
