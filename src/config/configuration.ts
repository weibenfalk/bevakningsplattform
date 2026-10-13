import { ConfigService } from '@nestjs/config';

/**
 * Alla inställningar på ett ställe: den enda filen som läser miljövariabler. Resten av koden får värdena via
 * `ConfigService` (laddad med `loadConfiguration`, se app.module.ts) eller, för rena funktioner som inte
 * injiceras, via `pipelineConfig`.
 */
export type Env = Record<string, string | undefined>;

export const DEFAULT_PORT = 3000;
/**
 * Lyssnar som standard bara på den egna datorn. Autentiseringen är en platshållare som litar på headern
 * `x-user-id` (se README), så servern ska inte vara nåbar utifrån. Sätt HOST för att ändra det, på eget ansvar.
 */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PIPELINE_NOW = '2026-10-01T07:00:00+02:00';

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

/** Ett giltigt portnummer (1–65535) ur PORT, annars 3000. */
export function parsePort(value: string | undefined): number {
  const port = Number(value?.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** Ett tal ur miljön, eller standardvärdet om det saknas eller inte är ett tal (Number('') är 0, vilket skulle släppa igenom allt). */
const envNumber = (env: Env, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

/** Trösklarna för pipelinen. Används via `pipelineConfig` nedan. */
export function loadPipelineConfig(env: Env) {
  return {
    triage: {
      batchSize: 20,
      // Gissad tröskel, inte kalibrerad (se "Medvetet bortvalt"). Specen siktar på att cirka 700 råposter ska bli cirka 200 kandidater.
      minScore: envNumber(env, 'TRIAGE_MIN_SCORE', 40),
    },
    dedupe: {
      sameStoryThreshold: envNumber(env, 'DEDUPE_THRESHOLD', 0.92),
    },
    retention: {
      // Specen: fulltext lagras bara för bearbetning och rensas efter 90 dagar.
      days: 90,
    },
    digest: {
      threshold: 55,
      maxItems: 18,
    },
  };
}

export function loadConfiguration(env: Env = process.env) {
  return {
    server: { port: parsePort(env.PORT), host: env.HOST?.trim() || DEFAULT_HOST },
    databaseUrl: resolveDatabaseUrl({ DATABASE_URL: env.DATABASE_URL, NODE_ENV: env.NODE_ENV }),
    adminUserIds: (env.ADMIN_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    pipelineNow: env.PIPELINE_NOW?.trim() || DEFAULT_PIPELINE_NOW,
  };
}

export type AppConfiguration = ReturnType<typeof loadConfiguration>;

/** Typad `ConfigService`: `config.get('server.port', { infer: true })` ger rätt typ. */
export type AppConfigService = ConfigService<AppConfiguration, true>;

let pipelineValues: ReturnType<typeof loadPipelineConfig> | undefined;
const pipelineValue = () => (pipelineValues ??= loadPipelineConfig(process.env));

/**
 * Trösklarna för rena funktioner som inte injiceras (till exempel `similarity.ts`). Läses vid första användningen och
 * inte vid import, så att en `.env` som `ConfigModule` läser in efter importen hinner gälla.
 */
export const pipelineConfig = {
  get triage() { return pipelineValue().triage; },
  get dedupe() { return pipelineValue().dedupe; },
  get retention() { return pipelineValue().retention; },
  get digest() { return pipelineValue().digest; },
};

/**
 * Kontrollerar miljön en gång vid start, så att ett fel syns direkt och inte först mitt i en körning.
 * Returnerar miljön oförändrad.
 *
 * PORT, TRIAGE_MIN_SCORE och DEDUPE_THRESHOLD kontrolleras inte här. Ett ogiltigt värde ger standardvärdet, och det är
 * dokumenterat och testat (configuration.spec.ts).
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const now = env.PIPELINE_NOW;
  if (typeof now === 'string' && now.trim() !== '' && Number.isNaN(new Date(now).getTime())) {
    errors.push(`PIPELINE_NOW är inte ett giltigt datum: "${now}"`);
  }
  try {
    loadConfiguration(env as Record<string, string | undefined>);
  } catch (err) {
    errors.push((err as Error).message);
  }
  if (errors.length) throw new Error(`Ogiltig konfiguration:\n- ${errors.join('\n- ')}`);
  return env;
}
