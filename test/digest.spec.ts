import { INestApplicationContext } from '@nestjs/common';
import { DigestService } from '../src/digest/digest.service';
import { closeTestingApp, createTestingApp, seedArticles, testKnex } from './helpers';

describe('DigestService: andra källor', () => {
  let app: INestApplicationContext;
  beforeEach(async () => {
    app = await createTestingApp();
    await seedArticles([
      { raw_id: 'a1', spaces: ['fonsterputs'], urgency: 'info', relevance: 90, cluster_id: 'c1', source_name: 'Egen källa',
        url: 'https://example.se/a1' },
      { raw_id: 'a2', spaces: ['fonsterputs'], urgency: 'info', relevance: 50, cluster_id: 'c1', source_name: 'Synlig källa',
        url: 'https://synlig.example.se/a2' },
      { raw_id: 'a3', spaces: ['takvard'], urgency: 'info', relevance: 50, cluster_id: 'c1', source_name: 'Hemlig takvårdskälla',
        url: 'https://hemlig.example.se/a3' },
      { raw_id: 'a4', spaces: ['fonsterputs'], urgency: 'info', relevance: 50, cluster_id: 'c1', source_name: 'Flaggad källa',
        url: 'https://flaggad.example.se/a4', needs_review: true },
    ]);
  });
  afterEach(closeTestingApp);

  it('visar källor inom användarens omfång', async () => {
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).toContain('Synlig källa');
  });

  it('visar aldrig källor från artiklar utanför användarens arbetsyta', async () => {
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).not.toContain('Hemlig takvårdskälla');
    expect(html).not.toContain('hemlig.example.se');
  });

  it('visar aldrig källor från artiklar flaggade för granskning', async () => {
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).not.toContain('Flaggad källa');
  });

  it('visar inte nekade entiteter eller kategorier som andra källor', async () => {
    await testKnex()('content_scopes').where({ user_id: 'u-anna' }).update({ deny_categories: ['konkurrent'] });
    await testKnex()('articles').where({ raw_id: 'a2' }).update({ categories: ['konkurrent'] });
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).not.toContain('Synlig källa');
  });

  it('räknar inte artikeln själv som en annan källa', async () => {
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).not.toContain('Egen källa</a>');
  });
});
