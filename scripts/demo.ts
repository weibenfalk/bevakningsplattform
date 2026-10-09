/**
 * Kör den ÄRVDA koden mot testdatan och visar vad varje användare får se.
 *
 *   npm run demo                 AI-stubben svarar som vanligt
 *   npm run demo -- --trasig-ai  AI:n svarar med något ogiltigt (som en riktig modell ibland gör)
 *
 * Skriptet ändrar inget i src/, det kopplar bara ihop delarna.
 */
import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { db } from './db';
import { AppModule } from '../src/app.module';
import { ArticleAccessService } from '../src/access/article-access.service';
import { renderDigest } from '../src/digest/render';
import { EntityImportService } from '../src/import/entity-import.service';
import { LLM, LlmProvider } from '../src/llm/llm.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { RawItem } from '../src/types';

const brokenAi = process.argv.includes('--trasig-ai');

/** En AI som svarar med text i stället för JSON. */
class BrokenAi implements LlmProvider {
  async embed() { return []; }
  async complete() { return 'Tyvärr, jag kan inte hjälpa till med det.'; }
}

/**
 * Vår egen bedömning av vilken arbetsyta varje nyhet borde tillhöra (ett antagande, inte facit).
 * Tom lista = brus som ingen borde få.
 */
const EXPECTED: Record<string, string[]> = {
  r01: ['takvard'], r02: ['takvard'], r03: ['takvard'], r04: ['takvard'], r05: ['takvard'],
  r06: ['takvard', 'fonsterputs'], r07: ['fonsterputs'], r08: [], r09: ['fonsterputs'],
  r10: [], r11: ['koncern'], r12: ['takvard'], r13: ['takvard'], r14: ['fonsterputs'], r15: [],
  r16: ['takvard', 'fonsterputs'], r17: ['takvard', 'fonsterputs'], r18: ['takvard'],
  r19: ['takvard'], r20: ['fonsterputs'], r21: ['takvard'], r22: ['takvard'],
};

const readJson = <T>(file: string): T => JSON.parse(readFileSync(`data/${file}`, 'utf8'));

async function main() {
  const knex = db();
  await knex.migrate.latest({ directory: 'migrations', loadExtensions: ['.ts'] });
  await knex.raw('TRUNCATE entity_matches, articles, entities, content_scopes RESTART IDENTITY');

  const users = readJson<{ id: string; name: string; role: string; scopes: string[] }[]>('users.json');
  await knex('content_scopes').insert(users.map((u) => ({ user_id: u.id, spaces: u.scopes })));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  if (brokenAi) {
    // Byt ut stubben mot den trasiga AI:n i båda pipelinestegen.
    const broken = new BrokenAi();
    (app.get(EnrichService) as any).llm = broken;
    (app.get(EnrichService) as any).triage.llm = broken;
  }

  console.log('\n== 1. Importerar entitetsregistret (data/entiteter.csv)');
  const report = await app.get(EntityImportService).importCsv('data/entiteter.csv');
  console.log(`   ${report.imported} importerade, ${report.merged} dubbletter ihopslagna, ${report.rejected.length} avvisade`);
  for (const r of report.rejected) console.log(`   avvisad rad ${r.line} (${r.name || 'utan namn'}): ${r.reason}`);
  for (const m of report.mappings) console.log(`   mappad rad ${m.line} (${m.name}): "${m.from}" -> "${m.to}"`);
  const entities = await knex('entities').select('name', 'watch_level', 'domains').orderBy('id');
  for (const e of entities) console.log(`   "${e.name}"  nivå=${e.watch_level}  domäner=${JSON.stringify(e.domains)}`);

  console.log(`\n== 2. Kör pipelinen för dag 1 (${brokenAi ? 'TRASIG AI' : 'AI-stubben'})`);
  const items = [...readJson<RawItem[]>('raw_items.json'), ...readJson<RawItem[]>('raw_items_extra.json')];
  await app.get(EnrichService).run(items);
  const stored = await knex('articles').count<{ count: string }>('* as count').first();
  console.log(`   ${items.length} råposter in, ${stored?.count} artiklar sparade`);

  console.log('\n== 3. Vad varje användare får se (via ArticleAccessService, samma väg som mejl, sök och export)');
  mkdirSync('out', { recursive: true });
  const access = app.get(ArticleAccessService);

  for (const user of users) {
    const rows = await access.forUser(user.id, { sort: 'raw_id' });
    const wrong = rows.filter((r) => !(EXPECTED[r.raw_id] ?? []).some((s) => user.scopes.includes(s)));
    console.log(`\n   ${user.name} (${user.role}), behörighet: ${user.scopes.join(', ')}`);
    console.log(`   Ser ${rows.length} artiklar, varav ${wrong.length} som inte borde nå hen:`);
    for (const r of wrong) {
      const why = (EXPECTED[r.raw_id] ?? []).length ? `hör till ${EXPECTED[r.raw_id].join('+')}` : 'brus';
      console.log(`     ⚠ ${r.raw_id}  ${(r.title || '(ingen rubrik)').slice(0, 50).padEnd(50)} [${why}]`);
    }

    const file = `out/${user.id}.html`;
    writeFileSync(file, page(user.name, renderDigest(rows.map((r) => ({ ...r, otherSources: [] })))));
    console.log(`   Förhandsvisning av mejlet: ${file}`);
  }

  if (brokenAi) {
    const r01 = await knex('articles').where('raw_id', 'r01').first();
    console.log('\n== 4. Sammanfattningen av r01 när AI:n svarade fel:');
    console.log(`   "${r01.summary}"`);
    console.log(`   Samma som originaltexten? ${r01.summary === r01.full_text ? 'JA, hela artikeln hamnar i mejlet' : 'nej'}`);
  }

  console.log(
    '\nObs: förhandsvisningen hoppar över utskickets tröskel och visar alla artiklar. Entitetsträffar missar\n' +
      'fortfarande böjningar (fel 10), så entitetsvikten är ofullständig.\n',
  );

  await app.close();
  await knex.destroy();
}

const page = (name: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>Mejl till ${name}</title>` +
  `<body style="font-family:sans-serif;background:#eee"><h2 style="padding:0 24px">Mejl till ${name}</h2>` +
  `<div style="background:#fff;width:640px">${body}</div></body>`;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
