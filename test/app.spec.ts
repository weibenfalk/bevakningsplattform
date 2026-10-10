import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../src/db/knex.provider';
import { bootstrap, DEFAULT_HOST, DEFAULT_PORT, parsePort } from '../src/main';
import { closeTestingApp, createTestingApp, seedArticles, TEST_LOGGER } from './helpers';

describe('parsePort', () => {
  it('använder 3000 när PORT saknas, är tom eller inte är ett giltigt portnummer', () => {
    expect(DEFAULT_PORT).toBe(3000);
    for (const bad of [undefined, '', '  ', 'abc', '-1', '0', '70000', '80.5']) expect(parsePort(bad)).toBe(3000);
  });

  it('läser ett giltigt portnummer', () => {
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort(' 4000 ')).toBe(4000);
  });
});

describe('Appen startar och exporten fungerar över HTTP', () => {
  let server: INestApplication;
  let base: string;
  const OLD_ADMINS = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    await createTestingApp(); // tömmer och fyller databasen
    await seedArticles([
      { raw_id: 't1', spaces: ['takvard'], urgency: 'info', title: 'Takvårdsnyhet' },
      { raw_id: 'f1', spaces: ['fonsterputs'], urgency: 'info', title: 'Fönsternyhet' },
      { raw_id: 'f2', spaces: ['fonsterputs'], urgency: 'info', title: '=HYPERLINK("http://ond.example","klicka")' },
    ]);
    server = await bootstrap({ port: 0, logger: TEST_LOGGER });
    base = `http://127.0.0.1:${(server.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    // knexProvider stänger inte sin pool själv, så testet gör det. Annars hänger sig Jest.
    await server.get<Knex>(KNEX).destroy();
    await server.close();
    await closeTestingApp();
    if (OLD_ADMINS === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD_ADMINS;
  });
  beforeEach(() => { delete process.env.ADMIN_USER_IDS; });

  const get = (path: string, userId?: string) =>
    fetch(`${base}${path}`, { headers: userId ? { 'x-user-id': userId } : {} });

  it('lyssnar som standard bara på den egna datorn (autentiseringen är en platshållare)', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect((server.getHttpServer().address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('avvisar anrop utan användare med 401', async () => {
    expect((await get('/export/articles.csv')).status).toBe(401);
  });

  it('ger en vanlig användare CSV med bara det hen får se', async () => {
    const res = await get('/export/articles.csv', 'u-anna');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe('id,title,url,relevance');
    expect(body).toContain('Fönsternyhet');
    expect(body).not.toContain('Takvårdsnyhet');
  });

  it('neutraliserar CSV-formler i svaret', async () => {
    const body = await (await get('/export/articles.csv', 'u-anna')).text();
    expect(body).toContain(`"'=HYPERLINK(`);
    expect(body).not.toMatch(/,"=HYPERLINK/);
  });

  it('nekar en vanlig användare att ange en annan användare (403)', async () => {
    expect((await get('/export/articles.csv?userId=u-kalle', 'u-anna')).status).toBe(403);
  });

  it('låter en admin (ADMIN_USER_IDS) exportera en annan användares innehåll', async () => {
    process.env.ADMIN_USER_IDS = 'u-mikael';
    const body = await (await get('/export/articles.csv?userId=u-kalle', 'u-mikael')).text();
    expect(body).toContain('Takvårdsnyhet');
    expect(body).not.toContain('Fönsternyhet');
  });

  it('en roll i anropet gör ingen till admin', async () => {
    const res = await fetch(`${base}/export/articles.csv?userId=u-kalle`, {
      headers: { 'x-user-id': 'u-anna', 'x-user-role': 'admin' },
    });
    expect(res.status).toBe(403);
  });

  it('avvisar en ogiltig sortering med 400 (SQL-injektion)', async () => {
    expect((await get('/export/articles.csv?sort=(select%20pg_sleep(5))', 'u-anna')).status).toBe(400);
  });
});
