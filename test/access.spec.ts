import { ArticleAccessService } from '../src/access/article-access.service';
import { INestApplicationContext } from '@nestjs/common';
import { closeTestingApp, createTestingApp, seedArticles, testKnex } from './helpers';

describe('ArticleAccessService', () => {
  let access: ArticleAccessService;

  beforeAll(async () => {
    const app = await createTestingApp();
    access = app.get(ArticleAccessService);
    await seedArticles([
      { raw_id: 'r11', spaces: ['koncern'], urgency: 'bevaka', relevance: 80 },
      { raw_id: 'r16', spaces: ['takvard', 'fonsterputs'], urgency: 'agera', relevance: 70 },
    ]);
  });

  it.each([
    ['ger aldrig fönsterputs tillgång till koncerninnehåll (r11)', 'r11', false],
    ['ger fönsterputs tillgång till gemensamma nyheter (r16)', 'r16', true],
  ])('%s', async (_namn, rawId, synlig) => {
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id).includes(rawId)).toBe(synlig);
  });
});

describe('ArticleAccessService: omfånget är en hård gräns', () => {
  let app: INestApplicationContext;
  let access: ArticleAccessService;
  beforeEach(async () => {
    app = await createTestingApp();
    access = app.get(ArticleAccessService);
  });
  afterEach(closeTestingApp);

  it('en akut takvårdsnyhet når inte en användare som bara har fönsterputs', async () => {
    await seedArticles([{ raw_id: 'r01', spaces: ['takvard'], urgency: 'akut', relevance: 90 }]);
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id)).not.toContain('r01');
  });

  it('åtkomstmodulen lämnar aldrig ut fulltexten', async () => {
    await seedArticles([{ raw_id: 'r16', spaces: ['fonsterputs'], urgency: 'info', full_text: 'Hela texten' }]);
    const [row] = await access.forUser('u-anna');
    expect(row).not.toHaveProperty('full_text');
    expect(row).not.toHaveProperty('search_vector');
  });

  it('sort tar bara emot vitlistade kolumner (SQL-injektion via sort)', async () => {
    await seedArticles([
      { raw_id: 'a', spaces: ['fonsterputs'], urgency: 'info', relevance: 1 },
      { raw_id: 'b', spaces: ['fonsterputs'], urgency: 'info', relevance: 2 },
    ]);
    await expect(access.forUser('u-anna', { sort: '(select pg_sleep(0))' })).rejects.toThrow();
    await expect(access.forUser('u-anna', { sort: 'full_text' })).rejects.toThrow();
    await expect(access.forUser('u-anna', { sort: 'relevance; drop table articles' })).rejects.toThrow();
    const rows = await access.forUser('u-anna', { sort: 'relevance asc' });
    expect(rows.map((r) => r.raw_id)).toEqual(['a', 'b']);
  });

  it('sorterar fallande på relevans som standard', async () => {
    await seedArticles([
      { raw_id: 'a', spaces: ['fonsterputs'], urgency: 'info', relevance: 1 },
      { raw_id: 'b', spaces: ['fonsterputs'], urgency: 'info', relevance: 2 },
    ]);
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id)).toEqual(['b', 'a']);
  });

  it.each([
    [
      'entitet',
      { deny_entities: ['e-hemlig'] },
      [{ raw_id: 'x1', entity_ids: ['e-hemlig'] }],
      [],
    ],
    [
      'kategori',
      { deny_categories: ['konkurrent'] },
      [
        { raw_id: 'k1', categories: ['konkurrent'] },
        { raw_id: 'k2', categories: ['konkurrent', 'regler'] },
        { raw_id: 'k3', categories: ['regler'] },
        { raw_id: 'k4' },
      ],
      ['k3', 'k4'],
    ],
  ])('en nekad %s döljs även för artiklar inom användarens arbetsyta', async (_typ, deny, artiklar, forvantat) => {
    await testKnex()('content_scopes').where({ user_id: 'u-anna' }).update(deny);
    await seedArticles(artiklar.map((a) => ({ spaces: ['fonsterputs'], urgency: 'info' as const, ...a })));
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id).sort()).toEqual(forvantat);
  });

  it('en nekad kategori döljs även akuta artiklar och sökträffar', async () => {
    await testKnex()('content_scopes').where({ user_id: 'u-anna' }).update({ deny_categories: ['konkurrent'] });
    await seedArticles([
      { raw_id: 'k1', spaces: ['fonsterputs'], urgency: 'akut', categories: ['konkurrent'], title: 'Fönster konkurs' },
      { raw_id: 'k3', spaces: ['fonsterputs'], urgency: 'akut', categories: ['regler'], title: 'Fönster pris' },
    ]);
    const rows = await access.forUser('u-anna', { q: 'fönster' });
    expect(rows.map((r) => r.raw_id)).toEqual(['k3']);
  });

  it('en artikel flaggad för granskning visas aldrig, även om arbetsytan stämmer', async () => {
    await seedArticles([{ raw_id: 'f1', spaces: ['fonsterputs'], urgency: 'info', needs_review: true }]);
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id)).not.toContain('f1');
  });
});
