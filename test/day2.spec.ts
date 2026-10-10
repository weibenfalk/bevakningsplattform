import { INestApplicationContext } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { DigestService } from '../src/digest/digest.service';
import { pipelineConfig } from '../src/config/pipeline.config';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { RunLogService } from '../src/pipeline/run-log.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, testKnex } from './helpers';

const lasa = (fil: string): RawItem[] => JSON.parse(readFileSync(`data/${fil}`, 'utf8'));
const DAG1_ITEMS = [...lasa('raw_items.json'), ...lasa('raw_items_extra.json')];
const DAG2_ITEMS = lasa('raw_items_dag2.json');
const d02 = DAG2_ITEMS.find((i) => i.id === 'd02')!;

const DAG1 = new Date('2026-10-01T07:00:00+02:00');
const DAG2 = new Date('2026-10-03T07:00:00+02:00');
const USERS = ['u-mikael', 'u-kalle', 'u-anna'];

describe('dag 2 (raw_items_dag2.json, klockan 2026-10-03 07:00), med de riktiga posterna', () => {
  let app: INestApplicationContext;
  let digest: DigestService;
  let dag1Sent: Record<string, number[]>;
  let dag2Sent: Record<string, number[]>;
  let dag2Html: Record<string, string>;
  let r02Före: Record<string, any>;
  let report: Awaited<ReturnType<PipelineService['run']>>;

  beforeAll(async () => {
    app = await createTestingApp();
    digest = app.get(DigestService);
    const pipeline = app.get(PipelineService);

    // Dag 1: kör pipelinen och skicka utskicken.
    await pipeline.run(DAG1_ITEMS, { now: DAG1 });
    dag1Sent = {};
    for (const u of USERS) dag1Sent[u] = (await digest.send(u, DAG1)).articleIds;
    r02Före = await testKnex()('articles').where({ raw_id: 'r02' }).first();

    // Dag 2.
    report = await pipeline.run(DAG2_ITEMS, { now: DAG2 });
    dag2Sent = {};
    dag2Html = {};
    for (const u of USERS) {
      const sent = await digest.send(u, DAG2);
      dag2Sent[u] = sent.articleIds;
      dag2Html[u] = sent.html;
    }
  });
  afterAll(closeTestingApp);

  const art = (rawId: string) => testKnex()('articles').where({ raw_id: rawId }).first();

  it('d01 hoppas över som dubblett av r01', () => {
    expect(report.enrich.skipped).toEqual([expect.objectContaining({ rawId: 'd01', reason: 'duplicate', existingRawId: 'r01' })]);
  });

  it('d02 uppdaterar r02: texten och poängen byts och artikeln markeras som uppföljning', async () => {
    expect(report.enrich.updated).toEqual([expect.objectContaining({ rawId: 'd02', existingRawId: 'r02' })]);
    const r02 = await art('r02');
    expect(r02.full_text).toBe(d02.text);
    expect(r02.is_followup).toBe(true);
    expect(r02.updated_at.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(r02.relevance).toBeLessThan(r02Före.relevance);
    expect(await testKnex()('articles').where({ raw_id: 'd02' })).toEqual([]);
  });

  it('d02 skickas inte igen till dem som fick r02 på dag 1', async () => {
    const r02 = await art('r02');
    const fickDag1 = USERS.filter((u) => dag1Sent[u].includes(r02.id));
    expect(fickDag1.length).toBeGreaterThan(0); // annars bevisar testet ingenting
    for (const u of fickDag1) expect(dag2Sent[u]).not.toContain(r02.id);
    for (const u of fickDag1) expect(dag2Html[u]).not.toContain('Växjöfirma i konkurs');
  });

  it('d05 (rättelsen) är markerad och kommer med för alla som får se den', async () => {
    const d05 = await art('d05');
    expect(d05.is_correction).toBe(true);
    for (const u of ['u-kalle', 'u-mikael']) {
      expect(dag2Sent[u]).toContain(d05.id);
      expect(dag2Html[u]).toContain('Rättelse: rotavdraget 2027');
    }
  });

  it('d05 kommer med även om poängen skulle vara under tröskeln', async () => {
    const knex = testKnex();
    const d05 = await art('d05');
    // Låtsas att Kalle inte fått d05 än och att poängen är låg. Spara det som ändras och återställ efteråt.
    const sparade = await knex('delivery_items').where({ article_id: d05.id }).select('*');
    await knex('delivery_items').where({ article_id: d05.id }).delete();
    await knex('articles').where({ id: d05.id }).update({ relevance: 1 });
    expect(await digest.compose('u-kalle')).toContain('Rättelse: rotavdraget 2027');
    await knex('articles').where({ id: d05.id }).update({ relevance: d05.relevance });
    await knex('delivery_items').insert(sparade);
  });

  it('arbetsytan gäller även rättelsen: Anna (bara fönsterputs) får den inte', async () => {
    const d05 = await art('d05');
    expect(d05.spaces).not.toContain('fonsterputs');
    expect(dag2Sent['u-anna']).not.toContain(d05.id);
    expect(dag2Html['u-anna']).not.toContain('Rättelse');
  });

  it('inget som redan skickats på dag 1 skickas igen på dag 2', () => {
    for (const u of USERS) {
      const igen = dag2Sent[u].filter((idd) => dag1Sent[u].includes(idd));
      expect(igen).toEqual([]);
    }
  });

  it('dag 2 innehåller exakt det nya som användaren får se: över tröskeln och inte redan skickat, plus rättelser', async () => {
    const { threshold } = pipelineConfig.digest;
    for (const u of USERS) {
      const scope = (await testKnex()('content_scopes').where({ user_id: u }).first()).spaces as string[];
      const synliga = await testKnex()('articles').where({ needs_review: false }).whereRaw('spaces && ?::text[]', [scope]).select('id', 'relevance', 'is_correction');
      const förväntade = synliga
        .filter((a) => !dag1Sent[u].includes(a.id) && (a.is_correction || (a.relevance ?? 0) >= threshold))
        .map((a) => a.id)
        .sort((a, b) => a - b);
      expect([...dag2Sent[u]].sort((a, b) => a - b)).toEqual(förväntade);
    }
  });

  it('nya artiklar från dag 2 (d03, d04) behandlas som vanligt', async () => {
    for (const raw of ['d03', 'd04', 'd06']) expect(await art(raw)).toBeDefined();
    expect((await art('d04')).is_followup).toBe(false);
  });

  it('körloggen visar uppdateringen och dubbletten för dag 2', async () => {
    const dag2 = (await app.get(RunLogService).list()).slice(3);
    expect(dag2.map((r) => r.step)).toEqual(['ingest', 'enrich', 'profile_match']);
    expect(dag2[0]).toMatchObject({ itemsIn: 6, itemsOut: 5, itemsSkipped: 1 });
    expect(dag2[0].details).toMatchObject({ alreadyStored: 0, updates: 1 });
    // 4 nya (d03, d04, d05, d06) och 1 uppdatering går vidare.
    expect(dag2[1]).toMatchObject({ itemsIn: 5, itemsOut: 5, itemsSkipped: 0 });
    expect(dag2[1].details).toMatchObject({ updated: ['d02->r02'] });
  });
});
