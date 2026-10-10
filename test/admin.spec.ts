import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../src/db/knex.provider';
import { bootstrap } from '../src/main';
import { closeTestingApp, createTestingApp, seedArticles, testKnex, TEST_LOGGER } from './helpers';

const BREAKDOWN = { score: 80, base: 80, components: [], factors: [] };

describe('Admin: visa som en annan användare (läs-bara)', () => {
  let server: INestApplication;
  let base: string;
  const OLD_ADMINS = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    await createTestingApp();
    await seedArticles([
      { raw_id: 't1', spaces: ['takvard'], urgency: 'akut', relevance: 90, title: 'Takvårdsnyhet', full_text: 'HEMLIG-FULLTEXT', categories: ['konkurrent'] },
      { raw_id: 'f1', spaces: ['fonsterputs'], urgency: 'info', relevance: 60, title: 'Fönsternyhet', full_text: 'HEMLIG-FULLTEXT' },
      { raw_id: 'f2', spaces: ['fonsterputs'], urgency: 'info', relevance: 80, title: 'Fönster två', score_breakdown: JSON.stringify(BREAKDOWN), full_text: 'HEMLIG-FULLTEXT' },
    ]);
    const knex = testKnex();
    await knex('users').insert({ id: 'u-anna', name: 'Anna', role: 'reader' }).onConflict('id').ignore();
    await knex('profiles').insert({ id: 'pf-puts', owner_id: 'u-anna', spaces: ['fonsterputs'] });
    await knex('profile_versions').insert({ profile_id: 'pf-puts', version: 1, query: 'x' });
    const f2 = await knex('articles').where({ raw_id: 'f2' }).first();
    await knex('profile_matches').insert({ profile_id: 'pf-puts', profile_version: 1, article_id: f2.id, term: 'fönsterputs', score: 1 });
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

  const get = (path: string, userId?: string) => fetch(`${base}${path}`, { headers: userId ? { 'x-user-id': userId } : {} });

  const json = async (path: string, userId = 'u-mikael'): Promise<any> => (await get(path, userId)).json();

  test.each([
    ['/admin/users', 'u-anna', 403],
    ['/admin/view-as/u-kalle', 'u-anna', 403],
    ['/admin/view-as/u-anna', 'u-anna', 403], // inte ens den egna vyn: verktyget är bara för admin
    ['/admin/users', undefined, 401],
    ['/admin/view-as/u-kalle', undefined, 401],
  ])('%s som %s ger %i', async (path, userId, status) => {
    const res = await get(path, userId);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain('Takvårdsnyhet');
  });

  it('en admin ser användarna med namn, roll och arbetsytor', async () => {
    const res = await get('/admin/users', 'u-mikael');
    expect(res.status).toBe(200);
    const users: { id: string; name: string; role: string; spaces: string[] }[] = (await res.json()) as never;
    expect(users.find((u) => u.id === 'u-anna')).toEqual({ id: 'u-anna', name: 'Anna', role: 'Verksamhetschef fönsterputs', spaces: ['fonsterputs'] });
    expect(users.map((u) => u.id).sort()).toEqual(['u-anna', 'u-kalle', 'u-mikael']);
  });

  it('omfånget gäller: Anna ser aldrig takvård, inte ens en akut nyhet', async () => {
    const body = await json('/admin/view-as/u-anna');
    expect(body.user).toEqual({ id: 'u-anna', name: 'Anna', role: 'Verksamhetschef fönsterputs', spaces: ['fonsterputs'] });
    expect(body.articles.map((a: { title: string }) => a.title)).toEqual(['Fönster två', 'Fönsternyhet']);
    expect(JSON.stringify(body)).not.toContain('Takvårdsnyhet');
  });

  it('artikeln har titel, länk, poäng, brådska, arbetsytor, kategorier och profilträffar (profil och term)', async () => {
    const body = await json('/admin/view-as/u-anna');
    expect(body.articles[0]).toEqual({
      id: expect.any(Number),
      title: 'Fönster två',
      url: 'https://example.se/f2',
      relevance: 80,
      urgency: 'info',
      spaces: ['fonsterputs'],
      categories: [],
      scoreBreakdown: BREAKDOWN,
      profileMatches: [{ profileId: 'pf-puts', terms: ['fönsterputs'] }],
    });
    expect(body.articles[1].profileMatches).toEqual([]);
  });

  it('ingen full_text i svaret', async () => {
    for (const path of ['/admin/view-as/u-anna', '/admin/view-as/u-kalle', '/admin/users']) {
      const res = await get(path, 'u-mikael');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('full_text');
      expect(text).not.toContain('HEMLIG-FULLTEXT');
    }
  });

  it('en okänd användare ger 404', async () => {
    const res = await get('/admin/view-as/u-finns-inte', 'u-mikael');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('u-finns-inte'); // NestJS-felet från ContentScopeService, inte en saknad väg
  });
});
