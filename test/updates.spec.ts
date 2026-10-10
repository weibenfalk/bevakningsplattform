import { INestApplicationContext } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { ArticleAccessService } from '../src/access/article-access.service';
import { LlmProvider } from '../src/llm/llm.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { relevance } from '../src/pipeline/score';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, installLlm, scriptedLlm, testKnex } from './helpers';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lasa = (fil: string): RawItem[] => JSON.parse(readFileSync(`data/${fil}`, 'utf8'));
const hitta = (items: RawItem[], id: string) => items.find((i) => i.id === id)!;
const r02 = hitta(lasa('raw_items.json'), 'r02');
const d02 = hitta(lasa('raw_items_dag2.json'), 'd02');

const DAG1 = new Date('2026-10-01T07:00:00+02:00');
const DAG2 = new Date('2026-10-03T07:00:00+02:00');

const svar = (extra: object = {}) => ({
  summary: 's', business_areas: ['takvard'], categories: ['konkurrent'], urgency: 'info', impact: 85, confidence: 0.9, ...extra,
});

/** En AI som svarar olika beroende på texten, och räknar sina berikningsanrop. */
function llmEfterText(svara: (prompt: string) => object | string) {
  const bas = scriptedLlm({ enrich: {} });
  const anrop = { enrich: 0 };
  const llm: LlmProvider = {
    embed: bas.embed,
    complete: async (req) => {
      if (req.task === 'triage') return bas.complete(req);
      anrop.enrich++;
      const s = svara(req.prompt);
      return typeof s === 'string' ? s : JSON.stringify(s);
    },
  };
  return { llm, anrop };
}

describe('uppdateringar (d02 uppdaterar r02)', () => {
  let app: INestApplicationContext;
  let enrich: EnrichService;
  let anrop: { enrich: number };

  /** r02 får hög påverkan (85), uppdateringen d02 lägre (40). */
  const standard = (prompt: string) => svar({ impact: prompt.includes('oprioriterade') ? 40 : 85 });

  beforeEach(async () => {
    app = await createTestingApp();
    const ai = llmEfterText(standard);
    anrop = ai.anrop;
    enrich = installLlm(app, ai.llm);
  });
  afterEach(closeTestingApp);

  const artiklar = () => testKnex()('articles').select('*').orderBy('id');
  const skippade = () => testKnex()('skipped_items').select('*').orderBy('id');

  it('texten ersätts, artikeln behåller sitt id och sin identitet, och den markeras som uppföljning', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    expect(före.is_followup).toBe(false);
    expect(före.updated_at).toBeNull();

    const rapport = await enrich.run([d02], DAG2);
    const efter = await artiklar();
    expect(efter).toHaveLength(1);
    expect(efter[0]).toMatchObject({
      id: före.id,
      raw_id: 'r02',
      url: före.url,
      full_text: d02.text,
      title: d02.title,
      is_followup: true,
      needs_review: false,
    });
    expect(efter[0].content_hash).not.toBe(före.content_hash);
    expect(efter[0].updated_at.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(rapport.skipped).toEqual([]);
    expect(rapport.updated).toEqual([{ rawId: 'd02', existingRawId: 'r02', articleId: före.id }]);
    expect(rapport.stored.map((s) => s.id)).toEqual([före.id]);
  });

  it('poängen räknas om: ny påverkan och färskhet räknat från uppdateringen', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    await enrich.run([d02], DAG2);
    const [efter] = await artiklar();
    const förväntad = relevance(
      { impact: 40, confidence: 0.9, urgency: 'info', sourceWeight: 1.2, publishedAt: '2026-10-01T10:00:00.000Z', entities: [], isTrending: false, isFollowUp: false },
      DAG2,
    );
    expect(efter.impact).toBe(40);
    expect(efter.relevance).toBe(förväntad);
    expect(efter.relevance).not.toBe(före.relevance);
  });

  it('har artikeln redan funnits i ett utskick får uppdateringen faktorn 0,60', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    await app.get(ArticleAccessService).recordSent('u-kalle', [före.id], DAG1);
    await enrich.run([d02], DAG2);
    const [efter] = await artiklar();
    const utanFaktor = relevance(
      { impact: 40, confidence: 0.9, urgency: 'info', sourceWeight: 1.2, publishedAt: '2026-10-01T10:00:00.000Z', entities: [], isTrending: false },
      DAG2,
    );
    const medFaktor = relevance(
      { impact: 40, confidence: 0.9, urgency: 'info', sourceWeight: 1.2, publishedAt: '2026-10-01T10:00:00.000Z', entities: [], isTrending: false, isFollowUp: true },
      DAG2,
    );
    expect(medFaktor).toBeLessThan(utanFaktor);
    expect(efter.relevance).toBe(medFaktor);
    expect(efter.is_followup).toBe(true);
    // Uppdelningen skrivs om vid uppdateringen och visar uppföljningsfaktorn
    expect(efter.score_breakdown.score).toBe(medFaktor);
    expect(efter.score_breakdown.factors.map((f: { key: string }) => f.key)).toEqual(['uppföljning']);
  });

  it('har artikeln aldrig funnits i ett utskick får den ingen nedräkning, men markeras ändå som uppföljning', async () => {
    await enrich.run([r02], DAG1);
    await enrich.run([d02], DAG2);
    const [efter] = await artiklar();
    const utanFaktor = relevance(
      { impact: 40, confidence: 0.9, urgency: 'info', sourceWeight: 1.2, publishedAt: '2026-10-01T10:00:00.000Z', entities: [], isTrending: false },
      DAG2,
    );
    expect(efter.relevance).toBe(utanFaktor);
    expect(efter.is_followup).toBe(true);
  });

  it('en omkörning av uppdateringen tillämpas inte en gång till (inget nytt AI-anrop, och den loggas som dubblett)', async () => {
    await enrich.run([r02], DAG1);
    await enrich.run([d02], DAG2);
    const efterFörsta = await artiklar();
    const anropFöre = anrop.enrich;

    const rapport = await enrich.run([d02], DAG2);
    expect(await artiklar()).toEqual(efterFörsta);
    expect(anrop.enrich).toBe(anropFöre);
    expect(rapport.updated).toEqual([]);
    expect(rapport.skipped).toEqual([expect.objectContaining({ rawId: 'd02', reason: 'duplicate', existingRawId: 'r02' })]);
  });

  it('en äldre version skriver inte över en nyare (r02 efter d02)', async () => {
    await enrich.run([r02], DAG1);
    await enrich.run([d02], DAG2);
    const efterUppdatering = await artiklar();

    const rapport = await enrich.run([r02], DAG2);
    expect(await artiklar()).toEqual(efterUppdatering);
    expect(rapport.updated).toEqual([]);
    expect(rapport.skipped).toEqual([expect.objectContaining({ rawId: 'r02', reason: 'older_version', existingRawId: 'r02' })]);
  });

  it('ändrat innehåll utan att det går att avgöra vilken som är nyast ändras inte (samma tid)', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    const tvetydig = { ...r02, id: 'x1', text: 'Helt annan text om samma adress.' };
    const rapport = await enrich.run([tvetydig], DAG2);
    expect(await artiklar()).toEqual([före]);
    expect(rapport.skipped).toEqual([expect.objectContaining({ rawId: 'x1', reason: 'changed_content', existingRawId: 'r02' })]);
  });

  it('en uppdatering som är nyare enligt published_at utan updated_at tillämpas också', async () => {
    await enrich.run([r02], DAG1);
    const nyare = { ...r02, id: 'x2', text: 'Ny text.', published_at: '2026-10-02T09:00:00+02:00' };
    const rapport = await enrich.run([nyare], DAG2);
    expect(rapport.updated).toHaveLength(1);
    expect((await artiklar())[0]).toMatchObject({ raw_id: 'r02', full_text: 'Ny text.' });
  });

  it('ett ogiltigt AI-svar på en uppdatering ändrar inte den gamla artikeln, och uppdateringen loggas hel', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    installLlm(app, llmEfterText(() => 'Tyvärr, jag kan inte hjälpa till med det.').llm);

    const rapport = await enrich.run([d02], DAG2);
    expect(await artiklar()).toEqual([före]);
    expect(rapport.updated).toEqual([]);
    expect(rapport.skipped).toEqual([expect.objectContaining({ rawId: 'd02', reason: 'invalid_update', existingRawId: 'r02' })]);
    const [logg] = await skippade();
    expect(logg.payload.text).toBe(d02.text);
  });

  it('ett ogiltigt updated_at gör att uppdateringen inte tillämpas', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    const rapport = await enrich.run([{ ...d02, updated_at: 'igår' }], DAG2);
    expect(await artiklar()).toEqual([före]);
    expect(rapport.skipped).toEqual([expect.objectContaining({ rawId: 'd02', reason: 'invalid_update' })]);
  });

  it('arbetsytan kommer från den nya berikningen men fail closed gäller: ogiltig arbetsyta ändrar inget', async () => {
    await enrich.run([r02], DAG1);
    const [före] = await artiklar();
    installLlm(app, llmEfterText(() => svar({ business_areas: [] })).llm);
    await enrich.run([d02], DAG2);
    expect(await artiklar()).toEqual([före]);
  });

  it('uppdateringen kan flytta artikeln till en annan arbetsyta (den nya berikningen gäller)', async () => {
    await enrich.run([r02], DAG1);
    installLlm(app, llmEfterText(() => svar({ business_areas: ['takvard', 'fonsterputs'] })).llm);
    await enrich.run([d02], DAG2);
    expect((await artiklar())[0].spaces).toEqual(['takvard', 'fonsterputs']);
  });

  it('profilmatchningen körs om för den uppdaterade artikeln', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiler-'));
    const fil = join(dir, 'profiles.json');
    writeFileSync(fil, JSON.stringify([{ id: 'pf-borgenarer', user: 'u-kalle', query: 'oprioriterade AND borgenärer' }]));
    const pipeline = app.get(PipelineService);
    const träffar = () => testKnex()('profile_matches').pluck('term');

    await pipeline.run([r02], { profilesFile: fil, now: DAG1 });
    expect(await träffar()).toEqual([]);

    const kör = await pipeline.run([d02], { profilesFile: fil, now: DAG2 });
    expect(kör.enrich.updated).toHaveLength(1);
    expect((await träffar()).sort()).toEqual(['borgenärer', 'oprioriterade']);
  });
});
