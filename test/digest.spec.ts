import { INestApplicationContext } from '@nestjs/common';
import { pipelineConfig } from '../src/config/pipeline.config';
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

  it.each([
    ['utanför användarens arbetsyta', ['Hemlig takvårdskälla', 'hemlig.example.se']],
    ['flaggade för granskning', ['Flaggad källa']],
  ])('visar aldrig källor från artiklar %s', async (_namn, texter) => {
    const html = await app.get(DigestService).compose('u-anna');
    for (const text of texter) expect(html).not.toContain(text);
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

describe('DigestService: urval', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  const { threshold, maxItems } = pipelineConfig.digest;
  const rows = (html: string) => (html.match(/<tr>/g) ?? []).length;

  it('en artikel med exakt tröskelvärdet tas med, och en under den gör det inte', async () => {
    await seedArticles([
      { raw_id: 'p1', spaces: ['takvard'], urgency: 'info', relevance: threshold },
      { raw_id: 'p2', spaces: ['takvard'], urgency: 'info', relevance: threshold - 1 },
    ]);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html).toContain('Artikel p1');
    expect(html).not.toContain('Artikel p2');
  });

  it('sorterar före begränsningen: en akut artikel med lägre poäng tränger inte ut av mer relevanta', async () => {
    await seedArticles([
      ...Array.from({ length: maxItems }, (_, i) => ({
        raw_id: `i${String(i + 1).padStart(2, '0')}`, spaces: ['takvard'], urgency: 'info', relevance: 90 - i,
      })),
      { raw_id: 'akut1', spaces: ['takvard'], urgency: 'akut', relevance: threshold + 5 },
    ]);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(rows(html)).toBe(maxItems);
    expect(html).toContain('Artikel akut1');
    expect(html.indexOf('Artikel akut1')).toBeLessThan(html.indexOf('Artikel i01'));
    // Den som faller bort är den minst brådskande och minst relevanta.
    expect(html).not.toContain(`Artikel i${maxItems}`);
  });

  it('inom samma brådska kommer den mest relevanta först', async () => {
    await seedArticles([
      { raw_id: 'l1', spaces: ['takvard'], urgency: 'agera', relevance: 60 },
      { raw_id: 'h1', spaces: ['takvard'], urgency: 'agera', relevance: 80 },
    ]);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html.indexOf('Artikel h1')).toBeLessThan(html.indexOf('Artikel l1'));
  });
});

