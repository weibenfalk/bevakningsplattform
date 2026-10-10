import { ArticleAccessService } from '../src/access/article-access.service';
import { BadRequestException, INestApplicationContext } from '@nestjs/common';
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

  it('sort som inte är text (?sort=a&sort=b ger en lista) är ett 400-fel och inte ett TypeError', async () => {
    const access = app.get(ArticleAccessService);
    for (const sort of [['relevance', 'id'], { column: 'id' }, 5]) {
      await expect(access.forUser('u-anna', { sort: sort as never })).rejects.toThrow(BadRequestException);
    }
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

describe('ArticleAccessService: tillåtna och nekade listor, och högsta brådska (specens avsnitt 2)', () => {
  let access: ArticleAccessService;
  beforeEach(async () => {
    const app = await createTestingApp();
    access = app.get(ArticleAccessService);
  });
  afterEach(closeTestingApp);

  const scope = (patch: Record<string, unknown>) => testKnex()('content_scopes').where({ user_id: 'u-anna' }).update(patch);
  const visible = async (artiklar: Record<string, unknown>[], q?: string) => {
    await seedArticles(artiklar.map((a) => ({ spaces: ['fonsterputs'], urgency: 'info', ...a })));
    return (await access.forUser('u-anna', { q })).map((r) => r.raw_id).sort();
  };

  it('tomma listor betyder inga begränsningar utöver arbetsytan', async () => {
    const rows = await visible([
      { raw_id: 'a', categories: ['regler'], source_name: 's1', entity_ids: ['e1'], urgency: 'akut' },
      { raw_id: 'b', categories: [], source_name: null, entity_ids: [] },
    ]);
    expect(rows).toEqual(['a', 'b']);
  });

  it.each([
    ['kategori', { allow_categories: ['regler'] }],
    ['källa', { allow_sources: ['s1'] }],
    ['entitet', { allow_entities: ['e1'] }],
  ])('en tillåtelselista för %s visar bara det som är med på den', async (_typ, allow) => {
    await scope(allow);
    const rows = await visible([
      { raw_id: 'med', categories: ['regler'], source_name: 's1', entity_ids: ['e1'] },
      { raw_id: 'flera', categories: ['makro', 'regler'], source_name: 's1', entity_ids: ['e2', 'e1'] },
      { raw_id: 'utan', categories: ['makro'], source_name: 's2', entity_ids: ['e2'] },
      { raw_id: 'tom', categories: [], source_name: null, entity_ids: [] },
    ]);
    expect(rows).toEqual(['flera', 'med']);
  });

  it('en nekad källa döljs, även akut och i sökträffar', async () => {
    await scope({ deny_sources: ['s2'] });
    const rows = await visible(
      [
        { raw_id: 'ok', source_name: 's1', title: 'Fönster ok' },
        { raw_id: 'nekad', source_name: 's2', urgency: 'akut', title: 'Fönster nekad' },
      ],
      'fönster',
    );
    expect(rows).toEqual(['ok']);
  });

  it.each([
    ['kategori', { allow_categories: ['regler'], deny_categories: ['regler'] }],
    ['källa', { allow_sources: ['s1'], deny_sources: ['s1'] }],
    ['entitet', { allow_entities: ['e1'], deny_entities: ['e1'] }],
  ])('nekat vinner över tillåtet: %s som är både tillåten och nekad döljs', async (_typ, both) => {
    await scope(both);
    const rows = await visible([
      { raw_id: 'a', categories: ['regler'], source_name: 's1', entity_ids: ['e1'] },
      { raw_id: 'b', categories: ['regler'], source_name: 's1', entity_ids: ['e1'], urgency: 'akut' },
    ]);
    expect(rows).toEqual([]);
  });

  it.each([
    ['kategori', { allow_categories: ['regler'], deny_categories: ['konkurrent'] }, { categories: ['regler', 'konkurrent'] }],
    ['entitet', { allow_entities: ['e1'], deny_entities: ['e2'] }, { entity_ids: ['e1', 'e2'] }],
  ])('nekat vinner över tillåtet: en artikel med både tillåten och nekad %s döljs', async (_typ, lists, article) => {
    await scope(lists);
    const rows = await visible([
      { raw_id: 'bada', categories: ['regler'], entity_ids: ['e1'], ...article },
      { raw_id: 'bara-tillaten', categories: ['regler'], entity_ids: ['e1'] },
    ]);
    expect(rows).toEqual(['bara-tillaten']);
  });

  it('en artikel utan källa träffas inte av en nekad källa, men släpps inte in av en tillåtelselista', async () => {
    await scope({ deny_sources: ['s2'] });
    expect(await visible([{ raw_id: 'x', source_name: null }])).toEqual(['x']);
    await scope({ deny_sources: [], allow_sources: ['s1'] });
    expect(await visible([{ raw_id: 'y', source_name: null }])).toEqual([]);
  });

  it.each([
    ['akut', ['agera', 'akut', 'bevaka', 'info']],
    ['agera', ['agera', 'bevaka', 'info']],
    ['bevaka', ['bevaka', 'info']],
    ['info', ['info']],
  ])('högsta synliga brådska %s', async (max, forvantat) => {
    await scope({ max_urgency: max });
    const rows = await visible(['akut', 'agera', 'bevaka', 'info'].map((u) => ({ raw_id: u, urgency: u })));
    expect(rows).toEqual(forvantat);
  });

  it('en okänd högsta brådska är ett fel och visar inget (fail closed)', async () => {
    await scope({ max_urgency: 'extra-akut' });
    await seedArticles([{ raw_id: 'a', spaces: ['fonsterputs'], urgency: 'info' }]);
    await expect(access.forUser('u-anna')).rejects.toThrow(/brådska/i);
  });

  it('omfånget gäller även andra källor i utskicket (otherSources)', async () => {
    await scope({ deny_sources: ['s2'], max_urgency: 'agera' });
    await seedArticles([
      { raw_id: 'a', spaces: ['fonsterputs'], cluster_id: 'c1', source_name: 's1', urgency: 'info' },
      { raw_id: 'b', spaces: ['fonsterputs'], cluster_id: 'c1', source_name: 's2', urgency: 'info' },
      { raw_id: 'c', spaces: ['fonsterputs'], cluster_id: 'c1', source_name: 's3', urgency: 'akut' },
    ]);
    const other = await access.sourcesByCluster('u-anna', ['c1']);
    expect(other.get('c1')?.map((s) => s.source_name)).toEqual(['s1']);
  });
});
