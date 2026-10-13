import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { Knex } from 'knex';
import { CLOCK, Clock } from '../src/config/clock';
import { PurgeService } from '../src/pipeline/purge.service';
import { RunLogService } from '../src/runs/run-log.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, seedArticles, testKnex } from './helpers';

const DAG_MS = 24 * 60 * 60 * 1000;

describe('rensning efter 90 dagar (fel 35): fulltext och råposter', () => {
  let app: INestApplicationContext;
  let nu: Date;
  beforeEach(async () => {
    app = await createTestingApp();
    nu = app.get<Clock>(CLOCK).now();
  });
  afterEach(closeTestingApp);

  const fore = (dagar: number): Date => new Date(nu.getTime() - dagar * DAG_MS);
  const purge = () => app.get(PurgeService).run();
  const artikel = (rawId: string) => testKnex()('articles').where({ raw_id: rawId }).first();
  const skippad = (rawId: string) => testKnex()('skipped_items').where({ raw_id: rawId }).first();
  const seed = (rawId: string, extra: Record<string, unknown>) =>
    seedArticles([{ raw_id: rawId, spaces: ['takvard'], urgency: 'info', summary: `Sammanfattning ${rawId}`, full_text: `Text ${rawId}`, ...extra }]);
  const seedSkipped = (rawId: string, createdAt: Date) =>
    testKnex()('skipped_items').insert({
      raw_id: rawId, url: `https://example.se/${rawId}`, reason: 'duplicate', payload: JSON.stringify({ id: rawId, text: 'Hela råtexten' }), created_at: createdAt,
    });

  // Gränsen räknas mot den fasta klockan, inte mot datorns (som ligger efter 2026-10-01 07:00).
  it.each([
    ['89 dagar gammal', 89, true],
    ['exakt 90 dagar gammal', 90, true],
    ['91 dagar gammal', 91, false],
    ['ett halvår gammal', 180, false],
  ])('artikel, %s: fulltexten finns kvar: %s', async (_namn, dagar, finnsKvar) => {
    await seed('a1', { published_at: fore(dagar) });
    await purge();
    expect((await artikel('a1')).full_text).toBe(finnsKvar ? 'Text a1' : null);
  });

  it('artikeln, sammanfattningen och länken finns kvar efter rensningen', async () => {
    await seed('a1', { published_at: fore(200), title: 'Gammal nyhet', url: 'https://example.se/gammal' });
    await purge();
    expect(await artikel('a1')).toMatchObject({
      title: 'Gammal nyhet', summary: 'Sammanfattning a1', url: 'https://example.se/gammal', full_text: null,
    });
  });

  it('en uppdaterad artikel åldras från uppdateringen, eftersom den sparade texten är den nya versionen', async () => {
    await seed('a1', { published_at: fore(200), updated_at: fore(10) });
    await purge();
    expect((await artikel('a1')).full_text).toBe('Text a1');
  });

  // Utan publiceringsdatum räknas åldern från när artikeln sparades (fail closed: osäker ålder ska inte ge mer lagrad text).
  it.each([
    ['sparades för 89 dagar sedan', 89, true],
    ['sparades för exakt 90 dagar sedan', 90, true],
    ['sparades för 91 dagar sedan', 91, false],
  ])('artikel utan datum som %s: fulltexten finns kvar: %s', async (_namn, dagar, finnsKvar) => {
    await seed('a1', { published_at: null, updated_at: null, created_at: fore(dagar) });
    await purge();
    expect((await artikel('a1')).full_text).toBe(finnsKvar ? 'Text a1' : null);
  });

  it('publiceringsdatumet går före sparningstiden: en gammal artikel som sparades nyss rensas', async () => {
    await seed('a1', { published_at: fore(200), created_at: fore(1) });
    await purge();
    expect((await artikel('a1')).full_text).toBeNull();
  });

  it.each([
    ['89 dagar gammal', 89, true],
    ['exakt 90 dagar gammal', 90, true],
    ['91 dagar gammal', 91, false],
  ])('överhoppad post, %s: råposten finns kvar: %s', async (_namn, dagar, finnsKvar) => {
    await seedSkipped('s1', fore(dagar));
    await purge();
    expect((await skippad('s1')).payload).toEqual(finnsKvar ? { id: 's1', text: 'Hela råtexten' } : {});
  });

  it('en rensad överhoppad post behåller id, länk och orsak', async () => {
    await seedSkipped('s1', fore(120));
    await purge();
    expect(await skippad('s1')).toMatchObject({ raw_id: 's1', url: 'https://example.se/s1', reason: 'duplicate' });
  });

  describe('med riktiga poster genom pipelinen', () => {
    const lasa = (fil: string): RawItem[] => JSON.parse(readFileSync(`data/${fil}`, 'utf8'));
    const dag1 = () => [...lasa('raw_items.json'), ...lasa('raw_items_extra.json')];
    const rensaMed = (nuMs: number) =>
      new PurgeService(testKnex(), { now: () => new Date(nuMs) }, app.get(RunLogService)).run();
    const antalMedText = async (knex: Knex) => ({
      articles: Number((await knex('articles').whereNotNull('full_text').count<{ count: string }>('* as count').first())!.count),
      skipped: Number((await knex('skipped_items').whereRaw("payload <> '{}'::jsonb").count<{ count: string }>('* as count').first())!.count),
    });

    it('artiklar och överhoppade poster stämplas med pipelinens klocka, inte datorns', async () => {
      await app.get(PipelineService).run(dag1());
      const rader = [...(await testKnex()('articles').select('created_at')), ...(await testKnex()('skipped_items').select('created_at'))];
      expect(rader.length).toBeGreaterThan(20);
      expect(rader.map((r) => r.created_at.getTime())).toEqual(rader.map(() => nu.getTime()));
    });

    it('utan publiceringsdatum rensas båda slagen på samma dag: 89 dagar efter klockan inget, 91 dagar efter allt', async () => {
      await app.get(PipelineService).run(dag1());
      await testKnex()('articles').update({ published_at: null, updated_at: null });
      const start = await antalMedText(testKnex());
      expect(start.articles).toBeGreaterThan(0);
      expect(start.skipped).toBeGreaterThan(0);

      await rensaMed(nu.getTime() + 89 * DAG_MS);
      expect(await antalMedText(testKnex())).toEqual(start);

      await rensaMed(nu.getTime() + 91 * DAG_MS);
      expect(await antalMedText(testKnex())).toEqual({ articles: 0, skipped: 0 });
    });
  });

  it('rapporten räknar rensade artiklar och råposter, och bara de', async () => {
    await seed('gammal', { published_at: fore(100) });
    await seed('ny', { published_at: fore(5) });
    await seed('redan-tom', { published_at: fore(100), full_text: null });
    await seedSkipped('s-gammal', fore(100));
    await seedSkipped('s-ny', fore(5));
    expect(await purge()).toEqual({ articles: 1, skippedItems: 1 });
  });

  it('är idempotent: en andra körning rensar inget och ändrar inget', async () => {
    await seed('a1', { published_at: fore(100) });
    await seedSkipped('s1', fore(100));
    await purge();
    const fore2 = [await artikel('a1'), await skippad('s1')];
    expect(await purge()).toMatchObject({ articles: 0, skippedItems: 0 });
    expect([await artikel('a1'), await skippad('s1')]).toEqual(fore2);
  });

  it('loggar varje körning i pipeline_runs, med antal in, ut och rensade', async () => {
    await seed('a1', { published_at: fore(100) });
    await seed('a2', { published_at: fore(1) });
    await seedSkipped('s1', fore(100));
    await purge();
    await purge();
    const runs = (await app.get(RunLogService).list()).filter((r) => r.step === 'purge');
    expect(runs.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(runs[0]).toMatchObject({ itemsOut: 2, details: { articles: 1, skippedItems: 1 } });
    expect(runs[1]).toMatchObject({ itemsOut: 0, details: { articles: 0, skippedItems: 0 } });
    expect(runs[0].finishedAt).toBeInstanceOf(Date);
  });

  it('en rensning som misslyckas loggas som failed och felet kastas vidare', async () => {
    await testKnex().raw('ALTER TABLE skipped_items RENAME TO skipped_items_tillfalligt');
    try {
      await expect(purge()).rejects.toThrow();
      const runs = (await app.get(RunLogService).list()).filter((r) => r.step === 'purge');
      expect(runs.map((r) => r.status)).toEqual(['failed']);
    } finally {
      await testKnex().raw('ALTER TABLE skipped_items_tillfalligt RENAME TO skipped_items');
    }
  });
});
