import { INestApplicationContext } from '@nestjs/common';
import { ArticleAccessService } from '../src/access/article-access.service';
import { EnrichmentSchema, CATEGORIES } from '../src/llm/enrichment.schema';
import { LlmProvider } from '../src/llm/llm.provider';
import { StubProvider, stubBusinessAreas, stubImpact } from '../src/llm/stub.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { DigestService } from '../src/digest/digest.service';
import { closeTestingApp, createTestingApp, installLlm, scriptedLlm, testKnex } from './helpers';

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
        const enrich = installLlm(app, scriptedLlm({ enrich: {
          summary: 's', business_areas, categories: ['konkurrent'], urgency: 'info', impact: 10, confidence: 0.9,
        } }));
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

    it('när AI:n svarar fel sparas ingen sammanfattning (inte originaltexten) och artikeln flaggas', async () => {
      // Triage fungerar, men berikningen svarar med något ogiltigt.
      const enrich = installLlm(app, scriptedLlm({ enrich: 'inte JSON' }));
      await enrich.run([item]);
      const row = await testKnex()('articles').where({ raw_id: 'r01' }).first();
      expect(row?.summary).toBeNull();
      expect(row?.needs_review).toBe(true);
    });

    it('sparar kategorin på artikeln', async () => {
      await installLlm(app, scriptedLlm({ enrich: enrichment({ categories: ['konkurrent'] }) })).run([item]);
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

describe('Relevans kopplad till pipelinen', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  const llmWith = (extra: Record<string, unknown>): LlmProvider => scriptedLlm({ enrich: {
    summary: 's', business_areas: ['takvard'], categories: ['konkurrent'], urgency: 'info', impact: 80, confidence: 0.9, ...extra,
  } });
  const useLlm = (llm: LlmProvider) => installLlm(app, llm);
  const row = () => testKnex()('articles').where({ raw_id: 'r01' }).first();
  const NOW = new Date('2026-10-01T07:00:00+02:00');

  it('relevance räknas ut och sparas, och utskicket blir inte tomt', async () => {
    await useLlm(llmWith({})).run([item], NOW);
    const saved = await row();
    expect(Number.isInteger(saved.relevance)).toBe(true);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html).toContain('Konkursbeslut');
  });

  it('källvikten kommer från sources.json (Bolagsverket väger mer än en blogg)', async () => {
    const enrich = useLlm(llmWith({}));
    await enrich.run([item], NOW);
    const official = (await row()).relevance;
    await testKnex()('articles').where({ raw_id: 'r01' }).delete();
    await enrich.run([{ ...item, source: 'blogg' }], NOW);
    expect((await row()).relevance).toBeLessThan(official);
  });

  it('färskheten räknas mot den fasta klockan, inte mot datorns klocka', async () => {
    const enrich = useLlm(llmWith({}));
    await enrich.run([item], NOW);
    const fresh = (await row()).relevance;
    await testKnex()('articles').where({ raw_id: 'r01' }).delete();
    await enrich.run([item], new Date('2026-11-15T07:00:00+01:00'));
    expect((await row()).relevance).toBeLessThan(fresh);
  });

  it('entitetsvikten kommer från den högst viktade matchade entiteten, och entity_ids sparas', async () => {
    await testKnex()('entities').insert([
      { name: 'Takvårdarna i Småland AB', watch_level: 'low', aliases: ['Takvårdarna'], domains: ['takvardarna.se'] },
      { name: 'Småland AB', watch_level: 'critical', aliases: ['Småland AB'], domains: ['smaland-ab.se'] },
    ]);
    const enrich = useLlm(llmWith({}));
    await enrich.run([item], NOW);
    const saved = await row();
    expect(saved.entity_ids).toHaveLength(2);
    const withBoth = saved.relevance;
    await testKnex()('entities').where({ name: 'Småland AB' }).delete();
    await testKnex()('articles').where({ raw_id: 'r01' }).delete();
    await enrich.run([item], NOW);
    expect((await row()).relevance).toBeLessThan(withBoth);
  });

  it('en okänd källa kan inte poängsättas, så artikeln flaggas och publiceras inte', async () => {
    await useLlm(llmWith({})).run([{ ...item, source: 'finns-inte' }], NOW);
    const saved = await row();
    expect(saved.needs_review).toBe(true);
    expect(saved.spaces).toEqual([]);
    expect(saved.relevance).toBeNull();
  });
});

describe('Triage i pipelinen', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  const answer = { summary: 's', business_areas: ['takvard'], categories: ['konkurrent'], urgency: 'info', impact: 80, confidence: 0.9 };
  const NOW = new Date('2026-10-01T07:00:00+02:00');
  const count = () => testKnex()('articles').count<{ count: string }>('* as count').first().then((r) => Number(r?.count));

  it('ett ogiltigt triage-svar ger inga berikningar (tidigare släpptes allt igenom)', async () => {
    let enrichCalls = 0;
    const llm: LlmProvider = {
      embed: async () => [],
      complete: async (req) => {
        if (req.task === 'enrich') { enrichCalls++; return JSON.stringify(answer); }
        return 'Tyvärr, jag kan inte hjälpa till med det.';
      },
    };
    await installLlm(app, llm).run([item], NOW);
    expect(enrichCalls).toBe(0);
    expect(await count()).toBe(0);
  });

  it('en låg poäng sållas bort artikeln utan att den dyra berikningen anropas', async () => {
    let enrichCalls = 0;
    const base = scriptedLlm({ enrich: answer, triageScore: 5 });
    const llm: LlmProvider = { ...base, complete: async (req) => { if (req.task === 'enrich') enrichCalls++; return base.complete(req); } };
    await installLlm(app, llm).run([item], NOW);
    expect(enrichCalls).toBe(0);
    expect(await count()).toBe(0);
  });
});

describe('Stubben: påverkan efter nyckelord (gäller bara stubben)', () => {
  it.each([
    ['Växjö tingsrätt har beslutat om konkurs för Takvårdarna'],
    ['Rotavdraget sänks från 30 till 20 procent'],
    ['Arbetsmiljöverket inleder tillsyn mot taksäkerhet'],
    ['Koncernen planerar börsnotering under 2027'],
    ['KONKURSEN är ett faktum'],
  ])('hög påverkan: %s', (text) => {
    expect(stubImpact(text)).toBeGreaterThanOrEqual(80);
  });

  it('övrigt ger 50', () => {
    expect(stubImpact('Mina bästa städtips')).toBe(50);
    expect(stubImpact('')).toBe(50);
  });

  it('stubbens berikningssvar använder den, och arbetsyta och påverkan sätts oberoende av varandra', async () => {
    const answer = JSON.parse(await new StubProvider().complete({
      task: 'enrich', system: '', prompt: '<artikel>\nKonkurs\n\nTakvårdarna går i konkurs\n</artikel>',
    }));
    expect(answer.impact).toBeGreaterThanOrEqual(80);
    expect(answer.business_areas).toEqual(['takvard']);
  });
});

