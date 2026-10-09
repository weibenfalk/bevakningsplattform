import { ArticleAccessService } from '../src/access/article-access.service';
import { createTestingApp, seedArticles } from './helpers';

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
