import { INestApplicationContext } from '@nestjs/common';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntityImportService } from '../src/import/entity-import.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { ProfileMatchService } from '../src/pipeline/profile-match.service';
import { ProfileService } from '../src/profiles/profile.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, testKnex } from './helpers';

const lasa = (fil: string): RawItem[] => JSON.parse(readFileSync(`data/${fil}`, 'utf8'));
/** Dag 1 så som demon läser den. */
const dag1 = () => [...lasa('raw_items.json'), ...lasa('raw_items_extra.json')];

/** Skriver en profilfil i en tillfällig mapp. */
function profilfil(profiler: { id: string; user: string; query: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'profiler-'));
  const fil = join(dir, 'profiles.json');
  writeFileSync(fil, JSON.stringify(profiler));
  return fil;
}

/** Träffar som `profil/rå-id: term, term`, sorterade. */
async function traffar(): Promise<string[]> {
  const rows = await testKnex()('profile_matches as m')
    .join('articles as a', 'a.id', 'm.article_id')
    .select('m.profile_id', 'a.raw_id', 'm.term')
    .orderBy(['m.profile_id', 'a.raw_id', 'm.term']);
  const grupper = new Map<string, string[]>();
  for (const r of rows) grupper.set(`${r.profile_id}/${r.raw_id}`, [...(grupper.get(`${r.profile_id}/${r.raw_id}`) ?? []), r.term]);
  return [...grupper].map(([nyckel, termer]) => `${nyckel}: ${termer.join(', ')}`);
}

describe('ProfileService: profilerna läses in', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  it('de fyra giltiga profilerna sparas och de två trasiga hoppas över med felmeddelande och position', async () => {
    const report = await app.get(ProfileService).loadFromFile('data/profiles.json');
    expect(report.loaded.sort()).toEqual(['pf-koncern', 'pf-konkurrenter-tak', 'pf-regler', 'pf-rena']);
    expect(report.skipped.map((s) => s.id).sort()).toEqual(['pf-puts', 'pf-tak-pris']);
    const oparad = report.skipped.find((s) => s.id === 'pf-tak-pris')!;
    expect(oparad.reason).toBe("Parentesen '(' stängs aldrig (position 1)");
    expect(oparad.position).toBe(1);
    expect(report.skipped.find((s) => s.id === 'pf-puts')!.reason).toMatch(/Wildcard/);
    const ids = await testKnex()('profiles').pluck('id');
    expect(ids).not.toContain('pf-tak-pris');
    expect(ids).not.toContain('pf-puts');
  });

  it('profilens ägare får sitt omfång som arbetsyta', async () => {
    await app.get(ProfileService).loadFromFile('data/profiles.json');
    const kalle = await testKnex()('profiles').where({ id: 'pf-konkurrenter-tak' }).first();
    expect(kalle.owner_id).toBe('u-kalle');
    expect(kalle.spaces).toEqual(['takvard']);
  });

  it('en omkörning ger ingen ny version, men en ändrad fråga ger version 2', async () => {
    const profiles = app.get(ProfileService);
    const fil = profilfil([{ id: 'p1', user: 'u-kalle', query: 'Rikstak' }]);
    await profiles.loadFromFile(fil);
    await profiles.loadFromFile(fil);
    expect(await testKnex()('profile_versions').where({ profile_id: 'p1' }).pluck('version')).toEqual([1]);

    await profiles.loadFromFile(profilfil([{ id: 'p1', user: 'u-kalle', query: 'Rikstak OR Takvårdarna' }]));
    expect(await testKnex()('profile_versions').where({ profile_id: 'p1' }).orderBy('version').pluck('version')).toEqual([1, 2]);
    expect((await profiles.activeProfiles()).map((p) => [p.id, p.version, p.query])).toEqual([['p1', 2, 'Rikstak OR Takvårdarna']]);
  });

  it('en profil för en okänd användare hoppas över, och en profil utan fråga också', async () => {
    const report = await app.get(ProfileService).loadFromFile(
      profilfil([
        { id: 'p1', user: 'u-okand', query: 'Rikstak' },
        { id: 'p2', user: 'u-kalle', query: 7 as unknown as string },
      ]),
    );
    expect(report.loaded).toEqual([]);
    expect(report.skipped.map((s) => s.id)).toEqual(['p1', 'p2']);
    expect(report.skipped[0].reason).toMatch(/okänd användare|omfång/i);
  });

  it('en profil som blir trasig behåller sin senaste giltiga version och rapporteras', async () => {
    const profiles = app.get(ProfileService);
    await profiles.loadFromFile(profilfil([{ id: 'p1', user: 'u-kalle', query: 'Rikstak' }]));
    const report = await profiles.loadFromFile(profilfil([{ id: 'p1', user: 'u-kalle', query: '(Rikstak' }]));
    expect(report.skipped.map((s) => s.id)).toEqual(['p1']);
    expect((await profiles.activeProfiles()).map((p) => p.query)).toEqual(['Rikstak']);
  });
});

describe('fält som artiklarna inte har data för (fail closed)', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  it.each(['lang', 'author', 'region'])('en profil med fältet %s hoppas över med ett tydligt fel, och de andra läses in', async (falt) => {
    const report = await app.get(ProfileService).loadFromFile(
      profilfil([
        { id: 'p-utan', user: 'u-kalle', query: `NOT ${falt}:x` },
        { id: 'p-ok', user: 'u-kalle', query: 'Rikstak' },
      ]),
    );
    expect(report.loaded).toEqual(['p-ok']);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toMatchObject({ id: 'p-utan', position: 5 });
    expect(report.skipped[0].reason).toContain(`Fältet ${falt} stöds inte än`);
    expect(await testKnex()('profiles').pluck('id')).toEqual(['p-ok']);
  });

  it('NOT lang:en matchar inte längre allt: profilen körs inte alls', async () => {
    await app.get(PipelineService).run(dag1(), { profilesFile: profilfil([{ id: 'p', user: 'u-kalle', query: 'NOT lang:en' }]) });
    expect(await traffar()).toEqual([]);
  });

  it('en redan sparad profil med ett fält som inte stöds körs inte och rapporteras som ogiltig', async () => {
    const knex = testKnex();
    await knex('users').insert({ id: 'u-kalle', name: 'u-kalle', role: 'reader' });
    await knex('profiles').insert({ id: 'p-gammal', owner_id: 'u-kalle', spaces: ['takvard'] });
    await knex('profile_versions').insert({ profile_id: 'p-gammal', version: 1, query: 'NOT lang:en' });
    const { enrich } = await app.get(PipelineService).run(dag1(), { profilesFile: profilfil([]) });
    expect(enrich.stored.length).toBeGreaterThan(0);
    const report = await app.get(ProfileMatchService).run(enrich.stored);
    expect(report.invalid).toEqual(['p-gammal']);
    expect(await traffar()).toEqual([]);
  });
});

describe('PipelineService: profilmatchning efter berikningen', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  it('trasiga profiler stoppar inte körningen, och de matchar ingenting', async () => {
    const result = await app.get(PipelineService).run(dag1());
    expect(result.profiles.skipped.map((s) => s.id).sort()).toEqual(['pf-puts', 'pf-tak-pris']);
    const profiler = await testKnex()('profile_matches').distinct('profile_id').pluck('profile_id');
    expect(profiler).not.toContain('pf-tak-pris');
    expect(profiler).not.toContain('pf-puts');
    expect(result.enrich.stored.length).toBeGreaterThan(0);
  });

  it('träffarna sparas med profil, version, term och poäng', async () => {
    await app.get(PipelineService).run(dag1());
    const rad = await testKnex()('profile_matches as m')
      .join('articles as a', 'a.id', 'm.article_id')
      .where({ 'a.raw_id': 'r04', 'm.profile_id': 'pf-konkurrenter-tak' })
      .select('m.profile_version', 'm.term', 'm.score');
    expect(rad).toEqual([{ profile_version: 1, term: 'Rikstak', score: 1 }]);
  });

  it('pf-konkurrenter-tak träffar r04 men inte r10 (pumpatävlingen), och träffar den rätta termen', async () => {
    await app.get(PipelineService).run(dag1());
    const t = (await traffar()).filter((r) => r.startsWith('pf-konkurrenter-tak/'));
    expect(t).toContain('pf-konkurrenter-tak/r04: Rikstak');
    expect(t).toContain('pf-konkurrenter-tak/r01: Takvårdarna');
    expect(t.some((r) => r.includes('/r10:'))).toBe(false);
  });

  it('en omkörning av hela pipelinen ger inga dubbletter', async () => {
    const pipeline = app.get(PipelineService);
    await pipeline.run(dag1());
    const före = await traffar();
    expect(före.length).toBeGreaterThan(0);
    await pipeline.run(dag1());
    expect(await traffar()).toEqual(före);
  });

  it('samma artiklar matchade två gånger ger inga dubbletter eller sviter av gamla rader', async () => {
    const { enrich } = await app.get(PipelineService).run(dag1());
    const före = await testKnex()('profile_matches').count<{ count: string }>('* as count').first();
    await app.get(ProfileMatchService).run(enrich.stored);
    await app.get(ProfileMatchService).run(enrich.stored);
    const efter = await testKnex()('profile_matches').count<{ count: string }>('* as count').first();
    expect(efter?.count).toBe(före?.count);
  });

  it('profilägarens omfång är en hård gräns: Kalle (bara takvård) matchar inget som bara är fönsterputs', async () => {
    const fil = profilfil([{ id: 'pf-kalle-rena', user: 'u-kalle', query: 'Rena OR fönsterputsare' }]);
    await app.get(PipelineService).run(dag1(), { profilesFile: fil });
    // r09 ("Rena Fönster var här") och r07 (fönsterputsare) är bara fönsterputs.
    expect(await traffar()).toEqual([]);
  });

  it('en artikel flaggad för granskning matchas inte', async () => {
    const fil = profilfil([{ id: 'pf-alla', user: 'u-mikael', query: 'Rikstak OR Takvårdarna OR Fonster' }]);
    await app.get(PipelineService).run(dag1(), { profilesFile: fil });
    const flaggade = await testKnex()('articles').where({ needs_review: true }).pluck('raw_id');
    const matchade = (await traffar()).map((r) => r.split('/')[1].split(':')[0]);
    for (const id of flaggade) expect(matchade).not.toContain(id);
  });

  it('en fråga utan positiv term (bara NOT) sparas med frågan som term, så träffen inte försvinner', async () => {
    const fil = profilfil([{ id: 'pf-inte', user: 'u-kalle', query: 'NOT Rikstak' }]);
    await app.get(PipelineService).run(dag1(), { profilesFile: fil });
    const t = await traffar();
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((r) => r.endsWith(': NOT Rikstak'))).toBe(true);
  });

  it('fältet source fungerar: berikningen sparar källan i source_name', async () => {
    const fil = profilfil([{ id: 'pf-di', user: 'u-kalle', query: 'source:di' }]);
    await app.get(PipelineService).run(dag1(), { profilesFile: fil });
    const källor = await testKnex()('articles').whereIn('raw_id', ['r04', 'r13']).pluck('source_name');
    expect(källor).toEqual(['di', 'di']);
    expect((await traffar()).sort()).toEqual(['pf-di/r04: source:di', 'pf-di/r13: source:di']);
  });

  it('fältet entity söker i entitetens namn', async () => {
    await app.get(EntityImportService).importCsv('data/entiteter.csv');
    const fil = profilfil([{ id: 'pf-ent', user: 'u-kalle', query: 'entity:Rikstak AND title:köper' }]);
    await app.get(PipelineService).run(dag1(), { profilesFile: fil });
    const t = await traffar();
    expect(t.some((r) => r.startsWith('pf-ent/r04:'))).toBe(true);
  });

  it('en ändrad profil (version 2) ersätter gamla träffar för de artiklar som matchas om', async () => {
    const { enrich } = await app.get(PipelineService).run(dag1(), { profilesFile: profilfil([{ id: 'p1', user: 'u-kalle', query: 'Rikstak' }]) });
    await app.get(ProfileService).loadFromFile(profilfil([{ id: 'p1', user: 'u-kalle', query: 'Takvårdarna' }]));
    await app.get(ProfileMatchService).run(enrich.stored);
    const t = await traffar();
    expect(t.every((r) => r.endsWith(': Takvårdarna'))).toBe(true);
    expect(await testKnex()('profile_matches').distinct('profile_version').pluck('profile_version')).toEqual([2]);
  });
});
