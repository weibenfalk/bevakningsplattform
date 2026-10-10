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
    await createTestingApp();
    await seedArticles([
      { raw_id: 't1', spaces: ['takvard'], urgency: 'akut', relevance: 90, title: 'Rikstak köper lokal firma', summary: 'Affären gäller takvård', full_text: 'HEMLIG-FULLTEXT pumpatävling' },
      { raw_id: 'f1', spaces: ['fonsterputs'], urgency: 'info', relevance: 60, title: 'Rikstak öppnar fönsterputs', summary: 'Nytt bolag', full_text: 'HEMLIG-FULLTEXT' },
      { raw_id: 'f2', spaces: ['fonsterputs'], urgency: 'info', relevance: 70, title: 'Rena Fönster växer', summary: 'Pumpatävling i stan', full_text: null },
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
  beforeEach(() => { process.env.ADMIN_USER_IDS = 'u-mikael'; });

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
    expect(body.matches[0]).toEqual({ id: expect.any(Number), title: 'Rikstak köper lokal firma', url: 'https://example.se/t1', relevance: 90, terms: ['Rikstak', 'pumpa*'], textSource: 'fulltext' });
  });

  it('omfånget gäller: Anna får aldrig en takvårdsartikel som träff', async () => {
    const body = await runQuery('u-anna', 'Rikstak');
    expect(body.matches.map((m: { title: string }) => m.title)).toEqual(['Rikstak öppnar fönsterputs']);
    expect(JSON.stringify(body)).not.toContain('Rikstak köper');
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
    expect(Object.keys(body.matches[0]).sort()).toEqual(['id', 'relevance', 'terms', 'textSource', 'title', 'url']);
  });

  it('omfånget gäller även fulltexten: Anna träffar inte takvårdsartikelns text', async () => {
    const body = await runQuery('u-anna', 'pumpatävling');
    expect(body.matches.map((m: { title: string }) => m.title)).toEqual(['Rena Fönster växer']);
  });

  it('en artikel vars fulltext är rensad matchas på rubrik och sammanfattning, och det framgår i svaret', async () => {
    const body = await runQuery('u-anna', 'zebraput');
    expect(body.matches.map((m: { title: string; textSource: string }) => [m.title, m.textSource])).toEqual([
      ['Gammal nyhet', 'summary'],
      ['Ny nyhet', 'fulltext'],
    ]);
    // Annas omfång har 4 artiklar, och två av dem (f2 och g1) saknar fulltext
    expect(body).toMatchObject({ searched: 4, withoutFullText: 2 });
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
    const app = await createTestingApp();
    const dag1: RawItem[] = ['raw_items.json', 'raw_items_extra.json'].flatMap((f) => JSON.parse(readFileSync(`data/${f}`, 'utf8')));
    await app.get(PipelineService).run(dag1); // läser data/profiles.json och sparar träffarna i profile_matches
    process.env.ADMIN_USER_IDS = 'u-mikael';
    server = await bootstrap({ port: 0, logger: TEST_LOGGER });
    base = `http://127.0.0.1:${(server.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.get<Knex>(KNEX).destroy();
    await server.close();
    await closeTestingApp();
    if (OLD_ADMINS === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD_ADMINS;
  });

  it('pf-rena: samma artiklar och samma termer, även de som bara träffar i brödtexten (r06 och r08)', async () => {
    const profile = JSON.parse(readFileSync('data/profiles.json', 'utf8')).find((p: { id: string }) => p.id === 'pf-rena');
    const rows: { raw_id: string; term: string }[] = await testKnex()('profile_matches as m')
      .join('articles as a', 'a.id', 'm.article_id')
      .where('m.profile_id', 'pf-rena')
      .select('a.raw_id', 'a.id', 'm.term');
    const pipeline = new Map<number, string[]>();
    for (const r of rows as unknown as { id: number; term: string }[]) pipeline.set(r.id, [...(pipeline.get(r.id) ?? []), r.term].sort());

    const res = await fetch(`${base}/admin/query-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u-mikael' },
      body: JSON.stringify({ userId: profile.user, query: profile.query }),
    });
    const body = (await res.json()) as { matches: { id: number; terms: string[]; textSource: string }[] };
    const tester = new Map(body.matches.map((m) => [m.id, [...m.terms].sort()]));

    expect(pipeline.size).toBeGreaterThan(2);
    expect(tester).toEqual(pipeline);
    const rawIds = rows.map((r) => r.raw_id);
    expect(rawIds).toEqual(expect.arrayContaining(['r06', 'r08']));
    expect(new Set(body.matches.map((m) => m.textSource))).toEqual(new Set(['fulltext']));
  });
});
