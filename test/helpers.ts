import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Knex } from 'knex';
import { db } from '../scripts/db';
import { AppModule } from '../src/app.module';
import { KNEX } from '../src/db/knex.provider';
import { LlmProvider } from '../src/llm/llm.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { assertTestDatabase } from './test-database';

/**
 * Platshållare: testhjälparna saknades i startkoden.
 * Testerna kör mot en egen databas (bevakning_test, se test-database.ts) och tömmer tabellerna först.
 */
let app: INestApplicationContext | undefined;

// Stäng appen (och databaspoolen) efter varje testfil, så att originaltesterna kan stå orörda.
afterAll(() => closeTestingApp());

/** Tyst som standard. `TEST_LOGS=1` visar loggen när något felsöks. */
export const TEST_LOGGER: false | ('log' | 'warn' | 'error')[] = process.env.TEST_LOGS ? ['log', 'warn', 'error'] : false;

export async function createTestingApp(): Promise<INestApplicationContext> {
  // Före allt annat: vi tömmer tabellerna, så vi vägrar köra mot något som inte är en testdatabas.
  assertTestDatabase(process.env.DATABASE_URL);
  // En kvarlämnad app (t.ex. från en beforeAll) skulle annars tappa sin referens här och läcka sin pool.
  await closeTestingApp();
  const knex = db();
  await knex.migrate.latest({ directory: 'migrations', loadExtensions: ['.ts'] });
  await knex.raw('TRUNCATE skipped_items, entity_matches, articles, entities, content_scopes RESTART IDENTITY');
  const users: { id: string; scopes: string[] }[] = JSON.parse(readFileSync('data/users.json', 'utf8'));
  await knex('content_scopes').insert(users.map((u) => ({ user_id: u.id, spaces: u.scopes })));
  await knex.destroy();

  app = await NestFactory.createApplicationContext(AppModule, { logger: TEST_LOGGER });
  return app;
}

export function testKnex(): Knex {
  if (!app) throw new Error('Anropa createTestingApp() först');
  return app.get<Knex>(KNEX);
}

export async function seedArticles(rows: Record<string, unknown>[]): Promise<void> {
  await testKnex()('articles').insert(
    rows.map((r) => ({ url: `https://example.se/${r.raw_id}`, title: `Artikel ${r.raw_id}`, ...r })),
  );
}

export async function closeTestingApp(): Promise<void> {
  // Den ärvda knexProvider stänger inte sin anslutningspool, så vi gör det här.
  await app?.get<Knex>(KNEX).destroy();
  await app?.close();
  app = undefined;
}

/**
 * En LLM som svarar olika på triage och berikning, som en riktig modell. Triage ger varje artikel `triageScore`
 * (standard 80), och berikningen svarar med `enrich` (objekt som JSON, eller en sträng som den är).
 */
export function scriptedLlm(opts: { enrich: unknown; triageScore?: number }): LlmProvider {
  return {
    embed: async () => [],
    complete: async (req) => {
      if (req.task === 'triage') {
        const count = (req.prompt.match(/<artikel /g) ?? []).length;
        return JSON.stringify(Array(count).fill(opts.triageScore ?? 80));
      }
      return typeof opts.enrich === 'string' ? opts.enrich : JSON.stringify(opts.enrich);
    },
  };
}

/** Byter LLM i berikningen och i triage-steget, och returnerar berikningen. */
export function installLlm(app: INestApplicationContext, llm: LlmProvider): EnrichService {
  const enrich = app.get(EnrichService);
  const internals = enrich as unknown as { llm: LlmProvider; triage: { llm: LlmProvider } };
  internals.llm = llm;
  internals.triage.llm = llm;
  return enrich;
}
