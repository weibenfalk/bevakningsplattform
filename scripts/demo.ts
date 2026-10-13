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
import { assertDemoDatabase, db } from './db';
import { AppModule } from '../src/app.module';
import { ArticleAccessService } from '../src/access/article-access.service';
import { pipelineConfig } from '../src/config/pipeline.config';
import { DigestService } from '../src/digest/digest.service';
import { EntityImportService } from '../src/import/entity-import.service';
import { LLM, LlmProvider } from '../src/llm/llm.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { relevance } from '../src/pipeline/score';
import { loadSourceWeights } from '../src/config/sources';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { RunLogService } from '../src/runs/run-log.service';
import type { PipelineRun } from '../src/runs/run-log.service';
import { RawItem } from '../src/types';

const brokenAi = process.argv.includes('--trasig-ai');

/** Körningarnas klocka (CLAUDE.md): dag 1 = 2026-10-01 07:00, dag 2 = 2026-10-03 07:00. */
const DAG1 = new Date('2026-10-01T07:00:00+02:00');
const pipelineWeights = loadSourceWeights();
const DAG2 = new Date('2026-10-03T07:00:00+02:00');

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

function printRuns(runs: PipelineRun[]) {
  console.log('\n   Körningar (tabellen pipeline_runs, krav 7):');
  console.log(`   ${'steg'.padEnd(14)} ${'status'.padEnd(7)} ${'tid'.padStart(6)} ${'in'.padStart(4)} ${'ut'.padStart(4)} ${'överhoppade'.padStart(12)}  anmärkning`);
  for (const r of runs) {
    const ms = r.finishedAt ? `${r.finishedAt.getTime() - r.startedAt.getTime()} ms` : '-';
    const note = r.error ?? Object.entries(r.details).map(([k, v]) => `${k}=${v}`).join(', ');
    const n = (v: number | null) => String(v ?? '-');
    console.log(`   ${r.step.padEnd(14)} ${r.status.padEnd(7)} ${ms.padStart(6)} ${n(r.itemsIn).padStart(4)} ${n(r.itemsOut).padStart(4)} ${n(r.itemsSkipped).padStart(12)}  ${note}`);
  }
}

async function main() {
  assertDemoDatabase();
  const knex = db();
  await knex.migrate.latest({ directory: 'migrations', loadExtensions: ['.ts'] });
  await knex.raw('TRUNCATE skipped_items, entity_matches, articles, entities, content_scopes, profile_matches, profile_versions, profiles, users, pipeline_runs, editions, publications RESTART IDENTITY CASCADE');

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
  const pipeline = await app.get(PipelineService).run(items, { now: DAG1 });
  const enrichReport = pipeline.enrich;
  const stored = await knex('articles').count<{ count: string }>('* as count').first();
  console.log(`   ${items.length} råposter in, ${stored?.count} artiklar sparade, ${enrichReport.skipped.length} överhoppade`);
  for (const s of enrichReport.skipped) {
    console.log(`   hoppade över ${s.rawId} (${s.reason})${s.existingRawId ? `, krockar med ${s.existingRawId}` : ''}`);
  }

  console.log(`   Profiler (data/profiles.json): ${pipeline.profiles.loaded.length} giltiga, ${pipeline.profiles.skipped.length} hoppades över`);
  for (const p of pipeline.profiles.skipped) console.log(`   hoppade över profilen ${p.id}: ${p.reason}`);
  console.log(`   Profilmatchning: ${pipeline.matching.profilesRun} profiler kördes mot ${pipeline.enrich.stored.length} nya artiklar, ${pipeline.matching.rows} träffar sparade`);

  printRuns(await app.get(RunLogService).list());

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

    // Profilträffar: bara användarens egna profiler. De filtrerar inte urvalet, utan förklarar det ("Varför:" i mejlet).
    const why = await access.profileMatchesForUser(user.id, rows.map((r) => r.id));
    const own = rows.filter((r) => why.has(r.id));
    console.log(`   Profilträffar (${own.length} av ${rows.length} artiklar):`);
    for (const r of own) {
      const profiles = why.get(r.id)!.map((w) => `${w.profileId} [${w.terms.join(', ')}]`).join(' · ');
      console.log(`     ${r.raw_id}  ${(r.title || '(ingen rubrik)').slice(0, 40).padEnd(40)} ${profiles}`);
    }
    const missed = rows.filter((r) => !why.has(r.id) && (r.relevance ?? 0) >= pipelineConfig.digest.threshold);
    if (missed.length) console.log(`   Utan profilträff men ändå med i urvalet: ${missed.map((r) => r.raw_id).join(', ')}`);

    // Det riktiga utskicket: DigestService med tröskel, sortering på brådska och andra källor.
    // Utskicket skickas och sparas i utskicksloggen, så att dag 2 vet vad användaren redan fått.
    const { html } = await app.get(DigestService).send(user.id, DAG1);
    const sent = rows
      .filter((r) => (r.relevance ?? 0) >= pipelineConfig.digest.threshold)
      .sort((a, b) => (a.raw_id < b.raw_id ? -1 : 1));
    const file = `out/${user.id}.html`;
    writeFileSync(file, page(user.name, html));
    console.log(`   Utskicket innehåller ${(html.match(/<tr>/g) ?? []).length} artiklar (tröskel ${pipelineConfig.digest.threshold}): ` +
      `${sent.map((r) => `${r.raw_id}(${r.relevance})`).join(', ') || 'inga'}`);
    console.log(`   Förhandsvisning av mejlet: ${file}`);
  }

  // ---- Dag 2 ----
  console.log('\n== 4. Dag 2 (raw_items_dag2.json, klockan 2026-10-03 07:00)');
  const items2 = readJson<RawItem[]>('raw_items_dag2.json');
  const r02Before = await knex('articles').where('raw_id', 'r02').first();
  const runsBefore = (await app.get(RunLogService).list()).length;
  const day2 = await app.get(PipelineService).run(items2, { now: DAG2 });
  const stored2 = await knex('articles').count<{ count: string }>('* as count').first();
  console.log(`   ${items2.length} råposter in, ${day2.enrich.stored.length - day2.enrich.updated.length} nya artiklar, ${day2.enrich.updated.length} uppdaterade, ${day2.enrich.skipped.length} överhoppade (${stored2?.count} artiklar totalt)`);
  for (const s of day2.enrich.skipped) {
    console.log(`   hoppade över ${s.rawId} (${s.reason})${s.existingRawId ? `, krockar med ${s.existingRawId}` : ''}`);
  }
  for (const u of day2.enrich.updated) {
    const now = await knex('articles').where('id', u.articleId).first();
    const sentTo = (await knex('delivery_items as di').join('deliveries as d', 'd.id', 'di.delivery_id').where('di.article_id', u.articleId).pluck('d.user_id')) as string[];
    console.log(`   ${u.rawId} uppdaterade ${u.existingRawId}: ny text, poäng ${r02Before.relevance} -> ${now.relevance}, markerad som uppföljning`);
    console.log(`     (poängen har faktorn 0,60 eftersom ${u.existingRawId} redan skickats till ${sentTo.map((id) => users.find((x) => x.id === id)?.name ?? id).join(' och ')})`);
  }
  // Trend (fel 21 och 26): minst 3 unika artiklar om samma entitet de senaste 30 dygnen ger faktorn ×1,25.
  const rikstak = await knex('entities').where('name', 'like', 'Rikstak%').first();
  const rikstakArtiklar = await knex('articles').whereRaw('entity_ids @> ARRAY[?]::text[]', [String(rikstak.id)]).orderBy('published_at');
  const d04 = rikstakArtiklar.find((a: { raw_id: string }) => a.raw_id === 'd04');
  const utanTrend = d04 && relevance(
    { impact: d04.impact, confidence: d04.confidence, urgency: d04.urgency, sourceWeight: pipelineWeights.get('di') ?? 0, publishedAt: d04.published_at.toISOString(), entities: [{ id: String(rikstak.id), watchLevel: 'critical' }], isTrending: false, isFollowUp: d04.is_followup },
    DAG2,
  );
  const räknas = rikstakArtiklar.filter((a: { source_name: string }) => (pipelineWeights.get(a.source_name) ?? 0) >= 1.0);
  const räknasEj = rikstakArtiklar.filter((a: { source_name: string }) => !räknas.includes(a));
  console.log(`   Trend: Rikstak har ${räknas.length} unika artiklar från källor med vikt minst 1,0 (${räknas.map((a: { raw_id: string }) => a.raw_id).join(', ')}) de senaste 30 dygnen`);
  console.log(`     Räknas inte (källvikt under 1,0): ${räknasEj.map((a: { raw_id: string }) => a.raw_id).join(', ') || 'inga'}`);
  if (d04) console.log(`     d04 ger trend: poäng ${utanTrend} utan faktorn -> ${d04.relevance} med ×1,25`);
  console.log(`   Profilmatchning: ${day2.matching.profilesRun} profiler kördes mot ${day2.enrich.stored.length} nya eller uppdaterade artiklar, ${day2.matching.rows} träffar sparade`);
  printRuns((await app.get(RunLogService).list()).slice(runsBefore));

  console.log('\n   Vad varje användare får dag 2 (rättelser ska alltid med, och det som redan skickats skickas inte igen):');
  const changedIds = day2.enrich.stored.map((s) => s.id);
  for (const user of users) {
    const { html, articleIds } = await app.get(DigestService).send(user.id, DAG2);
    const visible = await access.visibleAmong(user.id, changedIds);
    const sentDag1 = await access.sentTo(user.id, changedIds.filter((id) => !articleIds.includes(id)));
    writeFileSync(`out/${user.id}-dag2.html`, page(`${user.name}, dag 2`, html));
    console.log(`\n   ${user.name} (${user.role}): utskicket innehåller ${articleIds.length} artiklar`);
    for (const r of visible) {
      const tags = [r.is_correction ? 'rättelse' : '', r.is_followup ? 'uppföljning' : ''].filter(Boolean).join(', ');
      const title = (r.title || '(ingen rubrik)').slice(0, 44).padEnd(44);
      let verdict: string;
      if (articleIds.includes(r.id)) verdict = r.is_correction && (r.relevance ?? 0) < pipelineConfig.digest.threshold ? 'SKICKAS (rättelse, alltid med)' : 'SKICKAS';
      else if (sentDag1.has(r.id)) verdict = 'skickas inte igen (fick den redan dag 1)';
      else verdict = `skickas inte (relevans ${r.relevance} < ${pipelineConfig.digest.threshold})`;
      console.log(`     ${r.raw_id}  ${title} ${verdict}${tags ? `  [${tags}]` : ''}`);
    }
    const hidden = changedIds.length - visible.length;
    if (hidden) console.log(`     (${hidden} artiklar från dag 2 ligger utanför ${user.name}s arbetsyta och visas inte)`);
    console.log(`     Förhandsvisning av mejlet: out/${user.id}-dag2.html`);
  }

  const editions = await knex('editions as e')
    .join('deliveries as d', 'd.edition_id', 'e.id')
    .join('delivery_items as di', 'di.delivery_id', 'd.id')
    .groupBy('e.id', 'e.sent_at')
    .orderBy('e.sent_at')
    .select('e.id', 'e.sent_at')
    .countDistinct<{ deliveries: string }[]>('d.id as deliveries')
    .count<{ items: string }[]>('di.article_id as items');
  console.log('\n   Utskicksloggen (editions, deliveries och delivery_items):');
  for (const e of editions as unknown as { id: number; sent_at: Date; deliveries: string; items: string }[]) {
    console.log(`     utgåva ${e.id}, skickad ${e.sent_at.toISOString()}: ${e.deliveries} leveranser, ${e.items} artiklar`);
  }

  if (brokenAi) {
    const r01 = await knex('articles').where('raw_id', 'r01').first();
    console.log('\n== 5. Vad som händer med r01 när AI:n svarade fel:');
    if (!r01) {
      console.log('   Ingenting sparades: triage kunde inte bedöma någon post (ogiltigt svar), så ingen släpps igenom (fail closed).');
      console.log('   Originaltexten hamnar därmed aldrig i mejlet.');
    } else {
      console.log(`   "${r01.summary}"`);
      console.log(`   Samma som originaltexten? ${r01.summary === r01.full_text ? 'JA, hela artikeln hamnar i mejlet' : 'nej'}`);
    }
  }

  console.log(
    '\nObs: stubben (AI-ersättaren) sätter arbetsyta och påverkan efter nyckelord, så poängen visar flödet och är\n' +
      'ingen bedömning. Entitetsträffar matchar alias skiftlägeskänsligt\n' +
      'och bara med genitiv-s som böjning (fel 10).\n',
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
