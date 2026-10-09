import { INestApplicationContext } from '@nestjs/common';
import { ArticleAccessService } from '../src/access/article-access.service';
import { EnrichmentSchema, CATEGORIES } from '../src/llm/enrichment.schema';
import { LlmProvider } from '../src/llm/llm.provider';
import { stubBusinessAreas } from '../src/llm/stub.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { closeTestingApp, createTestingApp, testKnex } from './helpers';

const item = {
  id: 'r01',
  source: 'bolagsverket',
  url: 'https://poit.example.se/kungorelse/2026-123456',
  published_at: '2026-09-30T14:00:00+02:00',
  title: 'Konkursbeslut',
  text: 'Växjö tingsrätt har beslutat om konkurs för Takvårdarna i Småland AB, 556701-2233.',
};

const enrichment = (extra: Record<string, unknown>) => ({
  summary: 's', business_areas: ['takvard'], urgency: 'info', impact: 10, confidence: 0.9, ...extra,
});

describe('Kategori från berikningen', () => {
  it('godkänner kategorier ur den fasta listan', () => {
    expect(EnrichmentSchema.safeParse(enrichment({ categories: [CATEGORIES[0]] })).success).toBe(true);
  });

  it('avvisar en kategori som inte finns i listan', () => {
    expect(EnrichmentSchema.safeParse(enrichment({ categories: ['påhittad'] })).success).toBe(false);
  });

  it('avvisar ett svar utan kategori (ingen standardkategori)', () => {
    expect(EnrichmentSchema.safeParse(enrichment({})).success).toBe(false);
    expect(EnrichmentSchema.safeParse(enrichment({ categories: [] })).success).toBe(false);
  });

  describe('lagring', () => {
    let app: INestApplicationContext;
    beforeEach(async () => { app = await createTestingApp(); });
    afterEach(closeTestingApp);

    it('ett AI-svar utan giltig arbetsyta publiceras inte, utan sparas flaggad för granskning', async () => {
      for (const business_areas of [[], ['påhittad']]) {
        const llm: LlmProvider = {
          embed: async () => [],
          complete: async () => JSON.stringify({
            summary: 's', business_areas, categories: ['konkurrent'], urgency: 'info', impact: 10, confidence: 0.9,
          }),
        };
        const enrich = app.get(EnrichService);
        const internals = enrich as unknown as { llm: LlmProvider; triage: { llm: LlmProvider } };
        internals.llm = llm;
        internals.triage.llm = llm;
        await testKnex()('articles').where({ raw_id: 'r01' }).delete();
        await enrich.run([item]);

        const row = await testKnex()('articles').where({ raw_id: 'r01' }).first();
        expect(row).toBeDefined();
        expect(row.needs_review).toBe(true);
        for (const user of ['u-anna', 'u-kalle', 'u-mikael']) {
          const rows = await app.get(ArticleAccessService).forUser(user);
          expect(rows.map((r) => r.raw_id)).not.toContain('r01');
        }
      }
    });

    it('sparar kategorin på artikeln', async () => {
      const llm: LlmProvider = {
        embed: async () => [],
        complete: async () => JSON.stringify(enrichment({ categories: ['konkurrent'] })),
      };
      const enrich = app.get(EnrichService) as unknown as { llm: LlmProvider; triage: { llm: LlmProvider } };
      enrich.llm = llm;
      enrich.triage.llm = llm;
      await app.get(EnrichService).run([item]);
      const row = await testKnex()('articles').where({ raw_id: 'r01' }).first();
      expect(row?.categories).toEqual(['konkurrent']);
    });
  });
});

describe('Arbetsyta från berikningen', () => {
  it('avvisar ett svar utan arbetsyta och en arbetsyta utanför listan', () => {
    expect(EnrichmentSchema.safeParse(enrichment({ categories: ['regler'], business_areas: [] })).success).toBe(false);
    expect(EnrichmentSchema.safeParse(enrichment({ categories: ['regler'], business_areas: ['påhittad'] })).success).toBe(false);
  });

  it('stubben ger arbetsyta efter nyckelord, och tom lista när inget stämmer', () => {
    expect(stubBusinessAreas('Takvårdarna går i konkurs')).toEqual(['takvard']);
    expect(stubBusinessAreas('Fönsterputsare söks')).toEqual(['fonsterputs']);
    expect(stubBusinessAreas('Koncernen planerar börsnotering')).toEqual(['koncern']);
    expect(stubBusinessAreas('Rekordpumpa i Nybro')).toEqual([]);
  });
});
