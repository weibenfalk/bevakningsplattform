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

  it('ger aldrig fönsterputs tillgång till koncerninnehåll', async () => {
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id)).not.toContain('r11');
  });

  it('ger fönsterputs tillgång till gemensamma nyheter', async () => {
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id)).toContain('r16');
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

  it('en nekad entitet döljs även för artiklar inom användarens arbetsyta', async () => {
    await testKnex()('content_scopes').where({ user_id: 'u-anna' }).update({ deny_entities: ['e-hemlig'] });
    await seedArticles([{ raw_id: 'x1', spaces: ['fonsterputs'], urgency: 'info', entity_ids: ['e-hemlig'] }]);
    const rows = await access.forUser('u-anna');
    expect(rows.map((r) => r.raw_id)).not.toContain('x1');
  });
});
