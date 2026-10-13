import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../src/db/knex.provider';
import { bootstrap } from '../src/main';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, seedArticles, testKnex, TEST_LOGGER } from './helpers';

describe('Admin: frågetestare (POST /admin/query-test)', () => {
  let server: INestApplication;
  let base: string;
  const OLD_ADMINS = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    process.env.ADMIN_USER_IDS = 'u-mikael'; // konfigurationen läses när appen skapas
    await createTestingApp();
    await seedArticles([
      { raw_id: 't1', spaces: ['takvard'], urgency: 'akut', relevance: 90, title: 'Rikstak köper lokal firma', summary: 'Affären gäller takvård', full_text: 'HEMLIG-FULLTEXT pumpatävling' },
      { raw_id: 'f1', spaces: ['fonsterputs'], urgency: 'info', relevance: 60, title: 'Rikstak öppnar fönsterputs', summary: 'Nytt bolag', full_text: 'HEMLIG-FULLTEXT', source_name: 'di', categories: ['konkurrent'], entity_ids: ['7'] },
      { raw_id: 'f2', spaces: ['fonsterputs'], urgency: 'info', relevance: 70, title: 'Rena Fönster växer', summary: 'Pumpatävling i stan', full_text: null },
      { raw_id: 'h1', spaces: ['takvard'], urgency: 'info', relevance: 1, title: '', source_name: 'google_reviews', summary: 'Kort', full_text: 'xyzzyord' },
      // Akut, med kategori, entitet och källa som ett omfång kan neka. Flaggad artikel som aldrig ska synas.
      { raw_id: 'f3', spaces: ['fonsterputs'], urgency: 'akut', relevance: 3, title: 'Akut zorbaord', summary: 'Kort', full_text: 'HEMLIG', source_name: 'di', categories: ['konkurrent'], entity_ids: ['7'] },
      { raw_id: 'fl', spaces: ['fonsterputs'], urgency: 'info', relevance: 99, title: 'Flaggad zorbaord', summary: 'Kort', full_text: 'HEMLIG', needs_review: true },
      // Fulltexten rensad (efter 90 dagar) respektive kvar, med ordet bara i sammanfattningen respektive bara i texten
      { raw_id: 'g1', spaces: ['fonsterputs'], urgency: 'info', relevance: 10, title: 'Gammal nyhet', summary: 'Kort om zebraput', full_text: null },
      { raw_id: 'g2', spaces: ['fonsterputs'], urgency: 'info', relevance: 5, title: 'Ny nyhet', summary: 'Kort', full_text: 'HEMLIG zebraput i brödtexten' },
    ]);
    server = await bootstrap({ port: 0, logger: TEST_LOGGER });
    base = `http://127.0.0.1:${(server.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.get<Knex>(KNEX).destroy();
    await server.close();
    await closeTestingApp();
    if (OLD_ADMINS === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD_ADMINS;
  });
  // Ett test som ändrar Annas omfång lämnar det som det var
  afterEach(() => testKnex()('content_scopes').where({ user_id: 'u-anna' }).update({
    allow_categories: [], allow_sources: [], allow_entities: [], deny_categories: [], deny_sources: [], deny_entities: [], max_urgency: null,
  }));

  const post = (body: unknown, userId?: string) =>
    fetch(`${base}/admin/query-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
      body: JSON.stringify(body),
    });
  const runQuery = async (userId: string, query: string): Promise<any> => (await post({ userId, query }, 'u-mikael')).json();

  test.each([['u-anna', 403], [undefined, 401]])('som %s ger %i', async (caller, status) => {
    const res = await post({ userId: 'u-kalle', query: 'Rikstak' }, caller);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain('Rikstak köper');
  });

  it('syntaxfel kommer direkt, med position och utan träffar', async () => {
    const body = await runQuery('u-kalle', 'Rikstak AND (takvård');
    expect(body.syntaxError).toEqual({ message: expect.stringContaining('position'), position: expect.any(Number) });
    expect(body.matches).toBeUndefined();
    expect((await runQuery('u-kalle', '*putsning')).syntaxError.position).toBe(1);
  });

  it('träffar med den term som träffade, bäst poäng först', async () => {
    const body = await runQuery('u-mikael', 'Rikstak OR pumpa*');
    expect(body.syntaxError).toBeUndefined();
    expect(body.matches.map((m: { title: string }) => m.title)).toEqual(['Rikstak köper lokal firma', 'Rena Fönster växer', 'Rikstak öppnar fönsterputs']);
    expect(body.matches.map((m: { terms: string[] }) => m.terms)).toEqual([['Rikstak', 'pumpa*'], ['pumpa*'], ['Rikstak']]);
    expect(body.matches[0]).toEqual({ id: expect.any(Number), title: 'Rikstak köper lokal firma', url: 'https://example.se/t1', source: null, relevance: 90, spaces: ['takvard'], terms: ['Rikstak', 'pumpa*'], textSource: 'fulltext', visibleToUser: true, hiddenReasons: [] });
  });

  it('en träff utan rubrik har källans namn, så att den går att känna igen', async () => {
    const body = await runQuery('u-mikael', 'xyzzyord');
    expect(body.matches).toEqual([expect.objectContaining({ title: '', source: 'Google-recensioner' })]);
  });

  it('hela arkivet genomsöks: en träff utanför användarens omfång visas, märkt som osynlig med orsak', async () => {
    const body = await runQuery('u-anna', 'Rikstak');
    const row = (title: string) => body.matches.find((m: { title: string }) => m.title === title);
    expect(row('Rikstak öppnar fönsterputs')).toMatchObject({ visibleToUser: true, hiddenReasons: [], spaces: ['fonsterputs'] });
    expect(row('Rikstak köper lokal firma')).toMatchObject({
      visibleToUser: false,
      spaces: ['takvard'],
      hiddenReasons: ['Fel arbetsyta: artikeln är i takvard, användaren har fonsterputs'],
    });
    expect(body).toMatchObject({ visibleCount: 1 });
    expect(body.matches).toHaveLength(2);
  });

  test.each([
    ['nekad kategori', { deny_categories: ['konkurrent'] }, ['Nekad kategori: konkurrent']],
    ['nekad entitet', { deny_entities: ['7'] }, ['Nekad entitet: 7']],
    ['nekad källa', { deny_sources: ['di'] }, ['Nekad källa: Dagens industri']],
    ['för hög brådska', { max_urgency: 'agera' }, ['Brådskan akut syns inte för användaren (syns: agera, bevaka, info)']],
    ['ingen tillåten kategori', { allow_categories: ['regler'] }, ['Ingen av artikelns kategorier (konkurrent) är tillåten (tillåtna: regler)']],
    ['ingen tillåten källa', { allow_sources: ['smhi'] }, ['Ingen tillåten källa: artikeln är från Dagens industri (tillåtna: smhi)']],
    ['flera orsaker på en gång', { deny_categories: ['konkurrent'], max_urgency: 'agera' }, ['Nekad kategori: konkurrent', 'Brådskan akut syns inte för användaren (syns: agera, bevaka, info)']],
  ])('osynlig för Anna: %s', async (_namn, scope, reasons) => {
    await testKnex()('content_scopes').where({ user_id: 'u-anna' }).update(scope);
    const body = await runQuery('u-anna', 'zorbaord');
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ title: 'Akut zorbaord', visibleToUser: false, hiddenReasons: reasons });
    expect(body.visibleCount).toBe(0);
  });

  it('synligheten är densamma som åtkomstmodulens: utan nekade listor syns artikeln', async () => {
    const body = await runQuery('u-anna', 'zorbaord');
    expect(body.matches[0]).toMatchObject({ title: 'Akut zorbaord', visibleToUser: true, hiddenReasons: [] });
  });

  it('flaggade artiklar finns inte i arkivet som provas, för ingen', async () => {
    for (const user of ['u-anna', 'u-mikael']) {
      const body = await runQuery(user, 'zorbaord');
      expect(body.matches.map((m: { title: string }) => m.title)).toEqual(['Akut zorbaord']);
    }
  });

  it('matchar mot originaltexten men lämnar aldrig ut den: bara rubrik, poäng, term och varifrån texten kom', async () => {
    const body = await runQuery('u-mikael', 'pumpatävling');
    // t1 har ordet bara i fulltexten, f2 bara i sammanfattningen
    expect(body.matches.map((m: { title: string; textSource: string }) => [m.title, m.textSource])).toEqual([
      ['Rikstak köper lokal firma', 'fulltext'],
      ['Rena Fönster växer', 'summary'],
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('full_text');
    expect(text).not.toContain('HEMLIG');
    expect(Object.keys(body.matches[0]).sort()).toEqual(['hiddenReasons', 'id', 'relevance', 'source', 'spaces', 'terms', 'textSource', 'title', 'url', 'visibleToUser']);
  });

  it('en träff i fulltexten av en osynlig artikel läcker inte texten, bara att den finns och varför Anna inte ser den', async () => {
    const body = await runQuery('u-anna', 'pumpatävling');
    const t1 = body.matches.find((m: { title: string }) => m.title === 'Rikstak köper lokal firma');
    expect(t1).toMatchObject({ visibleToUser: false, textSource: 'fulltext' });
    expect(JSON.stringify(body)).not.toContain('HEMLIG');
  });

  it('en artikel vars fulltext är rensad matchas på rubrik och sammanfattning, och det framgår i svaret', async () => {
    const body = await runQuery('u-anna', 'zebraput');
    expect(body.visibleCount).toBe(2);
    expect(body.matches.map((m: { title: string; textSource: string }) => [m.title, m.textSource])).toEqual([
      ['Gammal nyhet', 'summary'],
      ['Ny nyhet', 'fulltext'],
    ]);
    // Arkivet har 7 ej flaggade artiklar (den flaggade räknas inte), och två av dem (f2 och g1) saknar fulltext
    expect(body).toMatchObject({ searched: 7, withoutFullText: 2 });
  });

  it('fält som artiklarna saknar data för ger syntaxfel, som i pipelinen', async () => {
    expect((await runQuery('u-kalle', 'lang:en')).syntaxError).toBeDefined();
  });

  test.each([[{}], [{ userId: 'u-kalle' }], [{ userId: 'u-kalle', query: 5 }], [{ userId: 'u-kalle', query: 'x'.repeat(2000) }]])('ogiltig indata %j ger 400', async (body) => {
    expect((await post(body, 'u-mikael')).status).toBe(400);
  });

  it('en okänd användare ger 404', async () => {
    expect((await post({ userId: 'u-finns-inte', query: 'Rikstak' }, 'u-mikael')).status).toBe(404);
  });
});

describe('Admin: frågetestaren ger samma träffar som profilmatchningen i pipelinen', () => {
  let server: INestApplication;
  let base: string;
  const OLD_ADMINS = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    process.env.ADMIN_USER_IDS = 'u-mikael'; // konfigurationen läses när appen skapas
    const app = await createTestingApp();
    const dag1: RawItem[] = ['raw_items.json', 'raw_items_extra.json'].flatMap((f) => JSON.parse(readFileSync(`data/${f}`, 'utf8')));
    await app.get(PipelineService).run(dag1); // läser data/profiles.json och sparar träffarna i profile_matches
    server = await bootstrap({ port: 0, logger: TEST_LOGGER });
    base = `http://127.0.0.1:${(server.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.get<Knex>(KNEX).destroy();
    await server.close();
    await closeTestingApp();
    if (OLD_ADMINS === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD_ADMINS;
  });

  test.each(['pf-rena', 'pf-konkurrenter-tak', 'pf-regler', 'pf-koncern'])('%s: samma artiklar och samma termer som pipelinen', async (profileId) => {
    const profile = JSON.parse(readFileSync('data/profiles.json', 'utf8')).find((p: { id: string }) => p.id === profileId);
    const rows: { raw_id: string; term: string }[] = await testKnex()('profile_matches as m')
      .join('articles as a', 'a.id', 'm.article_id')
      .where('m.profile_id', profileId)
      .select('a.raw_id', 'a.id', 'm.term');
    const pipeline = new Map<number, string[]>();
    for (const r of rows as unknown as { id: number; term: string }[]) pipeline.set(r.id, [...(pipeline.get(r.id) ?? []), r.term].sort());

    const res = await fetch(`${base}/admin/query-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u-mikael' },
      body: JSON.stringify({ userId: profile.user, query: profile.query }),
    });
    const body = (await res.json()) as { matches: { id: number; terms: string[]; textSource: string; visibleToUser: boolean; hiddenReasons: string[] }[] };
    // Arkivet genomsöks helt, men profilen träffar bara det ägaren får se
    const tester = new Map(body.matches.filter((m) => m.visibleToUser).map((m) => [m.id, [...m.terms].sort()]));

    expect(body.matches.filter((m) => !m.visibleToUser).every((m) => m.hiddenReasons.length > 0)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('orsaken gick inte att avgöra'); // förklaringen täcker allt som `scoped` döljer
    expect(pipeline.size).toBeGreaterThan(0);
    expect(tester).toEqual(pipeline);
    expect(new Set(body.matches.map((m) => m.textSource))).toEqual(new Set(['fulltext']));
    if (profileId === 'pf-rena') expect(rows.map((r) => r.raw_id)).toEqual(expect.arrayContaining(['r06', 'r08'])); // bara i brödtexten
  });

  it('(Rikstak OR Takvårdarna) AND NOT pumpa* ger bara artiklar om Rikstak eller Takvårdarna, och aldrig något om pumpor', async () => {
    // Testdatan har ingen artikel om pumpor, så NOT hade inget att utesluta. Lägg till två som nämner Rikstak.
    await seedArticles([
      { raw_id: 'x-pumpa1', spaces: ['takvard'], urgency: 'info', relevance: 50, title: 'Rikstak sponsrar pumpatävling', summary: 'Kort', full_text: 'Rikstak delar ut pumpor' },
      { raw_id: 'x-pumpa2', spaces: ['takvard'], urgency: 'info', relevance: 50, title: 'Takvårdarna och pumpa', summary: 'Kort', full_text: 'Takvårdarna bjöd på pumpa' },
    ]);
    const res = await fetch(`${base}/admin/query-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u-mikael' },
      body: JSON.stringify({ userId: 'u-mikael', query: '(Rikstak OR Takvårdarna) AND NOT pumpa*' }),
    });
    const body = (await res.json()) as { matches: { id: number; terms: string[] }[] };
    const articles: { id: number; title: string; full_text: string | null }[] = await testKnex()('articles').where('needs_review', false).select('id', 'title', 'full_text');
    const text = (a: { title: string; full_text: string | null }) => `${a.title} ${a.full_text ?? ''}`.toLowerCase();
    // En oberoende kontroll med enkel textsökning (genitiv som "Takvårdarnas" räknas med)
    const expected = articles.filter((a) => /rikstak|takvårdarna/.test(text(a)) && !text(a).includes('pumpa')).map((a) => a.id).sort((x, y) => x - y);

    expect(expected.length).toBeGreaterThan(3);
    expect(body.matches.map((m) => m.id).sort((x, y) => x - y)).toEqual(expected);
    for (const m of body.matches) expect(m.terms.every((t) => t === 'Rikstak' || t === 'Takvårdarna')).toBe(true);
    // Artiklarna om pumpor finns i arkivet men kommer inte med
    expect(articles.filter((a) => text(a).includes('pumpa')).length).toBeGreaterThan(0);
  });
});
