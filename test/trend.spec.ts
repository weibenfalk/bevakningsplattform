import { INestApplicationContext } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { EntityImportService } from '../src/import/entity-import.service';
import { EnrichService } from '../src/pipeline/enrich.service';
import { relevance } from '../src/pipeline/score';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, installLlm, scriptedLlm, seedArticles, testKnex } from './helpers';

const NU = new Date('2026-10-03T07:00:00+02:00');
const dagar = (n: number) => new Date(NU.getTime() - n * 864e5).toISOString();

const SVAR = { summary: 's', business_areas: ['takvard'], categories: ['konkurrent'], urgency: 'info', impact: 60, confidence: 0.9 };

const ny: RawItem = {
  id: 'n1', source: 'di', url: 'https://di.se/ny', title: 'Rikstak öppnar i Kalmar', text: 'Rikstak etablerar sig i Kalmar.',
  published_at: dagar(1),
} as RawItem;

describe('trend (fel 21 och 26): minst 3 unika artiklar om samma entitet de senaste 30 dygnen ger faktorn ×1,25', () => {
  let app: INestApplicationContext;
  let enrich: EnrichService;
  let rikstakId: string;

  beforeEach(async () => {
    app = await createTestingApp();
    enrich = installLlm(app, scriptedLlm({ enrich: SVAR }));
    const [e] = await testKnex()('entities').insert({ name: 'Rikstak', watch_level: 'critical', aliases: ['Rikstak'], space: 'takvard' }).returning('id');
    rikstakId = String(e.id);
  });
  afterEach(closeTestingApp);

  /** En tidigare sparad artikel om Rikstak: publicerad för `publicerad` dygn sedan, men sparad (created_at) i dag. */
  const tidigare = (rawId: string, publicerad: number, entityIds = [rikstakId]) => ({
    raw_id: rawId, entity_ids: entityIds, published_at: dagar(publicerad), created_at: NU, spaces: ['takvard'], urgency: 'info', impact: 60, confidence: 0.9,
  });

  const poäng = (isTrending: boolean, publishedAt = ny.published_at!) =>
    relevance(
      { impact: 60, confidence: 0.9, urgency: 'info', sourceWeight: 1.5, publishedAt, entities: [{ id: rikstakId, watchLevel: 'critical' }], isTrending, isFollowUp: false },
      NU,
    );

  test.each([
    ['två tidigare i fönstret + den nya = 3', [5, 23], true, null],
    ['bara en tidigare + den nya = 2', [5], false, null],
    ['en av två tidigare är 31 dygn gammal (publicerad, fast sparad i dag)', [5, 31], false, null],
    ['tidigare artiklar om en annan entitet räknas inte', [5, 23], false, ['999']],
  ])('%s', async (_namn, åldrar, förväntad, entityIds) => {
    await seedArticles((åldrar as number[]).map((d, i) => tidigare(`t${i}`, d, (entityIds as string[] | null) ?? [rikstakId])));
    await enrich.run([ny], NU);
    const row = await testKnex()('articles').where('raw_id', 'n1').first();
    expect(row.relevance).toBe(poäng(förväntad as boolean));
    expect(poäng(true)).toBeGreaterThan(poäng(false));
  });

  it('räknar unika artiklar, inte rader: flera rader i entity_matches för samma artikel ger inte trend', async () => {
    await seedArticles([tidigare('t0', 5)]);
    const { id } = await testKnex()('articles').where('raw_id', 't0').first();
    await testKnex()('entity_matches').insert([1, 2, 3, 4].map(() => ({ entity_id: rikstakId, article_id: id, created_at: NU })));
    await enrich.run([ny], NU);
    const row = await testKnex()('articles').where('raw_id', 'n1').first();
    expect(row.relevance).toBe(poäng(false));
  });

  it('en artikel som uppdateras räknar sig själv bara en gång', async () => {
    await seedArticles([tidigare('t0', 5), { ...tidigare('n1', 1), url: 'https://di.se/ny', full_text: 'gammal' }]);
    const uppdaterad = { ...ny, id: 'n1b', updated_at: dagar(0.5) } as RawItem;
    await enrich.run([uppdaterad], NU);
    const row = await testKnex()('articles').where('raw_id', 'n1').first();
    expect(row.relevance).toBe(poäng(false, uppdaterad.updated_at!));
  });

  it('riktiga data: d04 gör Rikstak till trend (r04 och r13 finns sedan dag 1)', async () => {
    const lasa = (f: string): RawItem[] => JSON.parse(readFileSync(`data/${f}`, 'utf8'));
    await testKnex()('entities').del();
    await app.get(EntityImportService).importCsv('data/entiteter.csv');
    const DAG1 = new Date('2026-10-01T07:00:00+02:00');
    await enrich.run(lasa('raw_items.json'), DAG1);
    const före = await testKnex()('articles').whereIn('raw_id', ['r04', 'r13']).orderBy('raw_id');
    expect(före).toHaveLength(2);
    await enrich.run(lasa('raw_items_dag2.json'), NU);
    const d04 = await testKnex()('articles').where('raw_id', 'd04').first();
    const rikstak = await testKnex()('entities').where('name', 'like', 'Rikstak%').first();
    expect(d04.entity_ids).toContain(String(rikstak.id));
    const utanTrend = relevance(
      { impact: d04.impact, confidence: d04.confidence, urgency: d04.urgency, sourceWeight: 1.5, publishedAt: d04.published_at.toISOString(), entities: [{ id: String(rikstak.id), watchLevel: 'critical' }], isTrending: false, isFollowUp: false },
      NU,
    );
    expect(d04.relevance).toBeGreaterThan(utanTrend);
  });
});
