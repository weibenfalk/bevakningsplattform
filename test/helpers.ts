import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Knex } from 'knex';
import { db } from '../scripts/db';
import { AppModule } from '../src/app.module';
import { KNEX } from '../src/db/knex.provider';

/**
 * Platshållare: testhjälparna saknades i startkoden.
 * Testerna kör mot samma databas som docker-compose startar och tömmer tabellerna först.
 */
let app: INestApplicationContext | undefined;

// Stäng appen (och databaspoolen) efter varje testfil, så att originaltesterna kan stå orörda.
afterAll(() => closeTestingApp());

export async function createTestingApp(): Promise<INestApplicationContext> {
  // En kvarlämnad app (t.ex. från en beforeAll) skulle annars tappa sin referens här och läcka sin pool.
  await closeTestingApp();
  const knex = db();
  await knex.migrate.latest({ directory: 'migrations', loadExtensions: ['.ts'] });
  await knex.raw('TRUNCATE entity_matches, articles, entities, content_scopes RESTART IDENTITY');
  const users: { id: string; scopes: string[] }[] = JSON.parse(readFileSync('data/users.json', 'utf8'));
  await knex('content_scopes').insert(users.map((u) => ({ user_id: u.id, spaces: u.scopes })));
  await knex.destroy();

  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
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
