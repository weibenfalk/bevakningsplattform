import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { DigestService } from '../src/digest/digest.service';
import { LlmProvider } from '../src/llm/llm.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, installLlm, scriptedLlm, testKnex } from './helpers';

const load = (file: string): RawItem[] => JSON.parse(readFileSync(`data/${file}`, 'utf8'));
const day1 = load('raw_items.json');
const extra = load('raw_items_extra.json');
const day2 = load('raw_items_dag2.json');
const find = (items: RawItem[], id: string) => items.find((i) => i.id === id)!;

const r01 = find(day1, 'r01');
const r02 = find(day1, 'r02');
const r03 = find(day1, 'r03');
const r09a = find(day1, 'r09');
const r09b = find(extra, 'r09');
const d01 = find(day2, 'd01');
const d02 = find(day2, 'd02');

const NOW = new Date('2026-10-01T07:00:00+02:00');
const answer = { summary: 's', business_areas: ['takvard'], categories: ['konkurrent'], urgency: 'info', impact: 85, confidence: 0.9 };

describe('Dubbletter och idempotens (krav 7)', () => {
  let app: INestApplicationContext;
  let aiCalls: number;
  let enrich: EnrichService;

  beforeEach(async () => {
    app = await createTestingApp();
    aiCalls = 0;
    const base = scriptedLlm({ enrich: answer });
    const llm: LlmProvider = { ...base, complete: async (req) => { aiCalls++; return base.complete(req); } };
    enrich = installLlm(app, llm);
  });
  afterEach(closeTestingApp);

  const articles = () => testKnex()('articles').select('raw_id', 'url', 'title', 'full_text').orderBy('id');
  const skipped = () => testKnex()('skipped_items').select('*').orderBy('id');

  describe('samma URL (r01 och r03 är samma kungörelse)', () => {
    it('sparas bara en gång, och dubbletten loggas med vilken artikel den krockade med', async () => {
      const report = await enrich.run([r01, r03], NOW);
      expect((await articles()).map((a) => a.raw_id)).toEqual(['r01']);
      expect(report.skipped).toEqual([expect.objectContaining({ rawId: 'r03', reason: 'duplicate', existingRawId: 'r01' })]);
      expect(await skipped()).toEqual([expect.objectContaining({ raw_id: 'r03', reason: 'duplicate', existing_raw_id: 'r01' })]);
    });

    it('den första vinner, oberoende av ordning', async () => {
      await enrich.run([r03, r01], NOW);
      expect((await articles()).map((a) => a.raw_id)).toEqual(['r03']);
      expect((await skipped())[0]).toMatchObject({ raw_id: 'r01', reason: 'duplicate', existing_raw_id: 'r03' });
    });

    it('nästa dags post med samma URL (d01) blir inte en ny artikel', async () => {
      await enrich.run([r01], NOW);
      await enrich.run([d01], new Date('2026-10-03T07:00:00+02:00'));
      expect((await articles()).map((a) => a.raw_id)).toEqual(['r01']);
      expect((await skipped())[0]).toMatchObject({ raw_id: 'd01', reason: 'duplicate', existing_raw_id: 'r01' });
    });

    it('kungörelsen kommer bara med en gång i utskicket', async () => {
      await enrich.run([r01, r03], NOW);
      const html = await app.get(DigestService).compose('u-kalle');
      expect(html.match(/Konkursbeslut/g)).toHaveLength(1);
    });

    it('databasen vägrar två artiklar med samma URL, som sista skydd', async () => {
      const row = { raw_id: 'a', url: 'https://example.se/x', title: 't', spaces: ['takvard'], urgency: 'info' };
      await testKnex()('articles').insert(row);
      await expect(testKnex()('articles').insert({ ...row, raw_id: 'b' })).rejects.toThrow(/unique|duplicate/i);
    });
  });

  describe('samma post körs om', () => {
    it('ger inga nya artiklar, inga nya loggrader och inga nya AI-anrop', async () => {
      await enrich.run([r01, r03, r09a, r09b], NOW);
      const stored = await articles();
      const log = await skipped();
      const callsAfterFirstRun = aiCalls;

      const report = await enrich.run([r01, r03, r09a, r09b], NOW);
      expect(await articles()).toEqual(stored);
      expect(await skipped()).toEqual(log);
      expect(aiCalls).toBe(callsAfterFirstRun);
      expect(report.alreadyStored).toBe(2); // r01 och r09 (den första)
    });

    it('en omkörning av bara r01 räknas som redan sparad och loggas inte som dubblett', async () => {
      await enrich.run([r01], NOW);
      const report = await enrich.run([r01], NOW);
      expect(report.alreadyStored).toBe(1);
      expect(report.skipped).toEqual([]);
      expect(await skipped()).toEqual([]);
    });
  });

  describe('samma URL men nytt innehåll (d02 uppdaterar r02)', () => {
    // Uppdateringar tillämpas nu (se test/updates.spec.ts). Här kontrolleras bara att de inte blir en ny artikel
    // och att de inte hamnar i loggen över överhoppade poster.
    it('blir inte en ny artikel och loggas inte som överhoppad, eftersom den tillämpas', async () => {
      await enrich.run([r02], NOW);
      const report = await enrich.run([d02], new Date('2026-10-03T07:00:00+02:00'));
      expect((await articles()).map((a) => a.raw_id)).toEqual(['r02']);
      expect(report.skipped).toEqual([]);
      expect(report.updated).toEqual([expect.objectContaining({ rawId: 'd02', existingRawId: 'r02' })]);
      expect(await skipped()).toEqual([]);
    });
  });

  describe('samma id men olika innehåll (r09 förekommer två gånger)', () => {
    it('den andra sparas inte över den första utan loggas som kollision med hela råposten', async () => {
      const report = await enrich.run([r09a, r09b], NOW);
      const stored = await articles();
      expect(stored).toHaveLength(1);
      expect(stored[0].full_text).toBe(r09a.text);
      expect(report.skipped).toEqual([expect.objectContaining({ rawId: 'r09', reason: 'raw_id_collision', existingRawId: 'r09' })]);
      const [logged] = await skipped();
      expect(logged).toMatchObject({ raw_id: 'r09', reason: 'raw_id_collision' });
      expect(logged.payload).toMatchObject({ id: 'r09', url: r09b.url, text: r09b.text });
    });

    it('kollisionen mellan två helt olika poster upptäcks också när de ligger i olika körningar', async () => {
      await enrich.run([r09a], NOW);
      const report = await enrich.run([r09b], NOW);
      expect(report.skipped[0].reason).toBe('raw_id_collision');
      expect(await articles()).toHaveLength(1);
    });
  });

  it('en ogiltig URL stoppar inte körningen, utan loggas', async () => {
    const bad = { ...r01, id: 'bad', url: 'inte en url' };
    const report = await enrich.run([bad, r02], NOW);
    expect((await articles()).map((a) => a.raw_id)).toEqual(['r02']);
    expect(report.skipped).toEqual([expect.objectContaining({ rawId: 'bad', reason: 'invalid_url' })]);
  });

  it('tracking-parametrar och versaler i värdnamnet gör inte en post unik', async () => {
    const a = { ...r01, id: 'x1', url: 'https://POIT.example.se/kungorelse/2026-123456/?utm_source=a#del' };
    await enrich.run([r01, a], NOW);
    expect((await articles()).map((x) => x.raw_id)).toEqual(['r01']);
  });
});
