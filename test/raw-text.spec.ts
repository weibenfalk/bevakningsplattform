import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { globSync } from 'glob';
import { ExportController } from '../src/admin/export.controller';
import { DigestService } from '../src/digest/digest.service';
import { renderDigest } from '../src/digest/render';
import { closeTestingApp, createTestingApp, seedArticles } from './helpers';

const RAW = 'RÅTEXT-SKA-ALDRIG-LÄMNA-SYSTEMET';

describe('råtext lämnar aldrig systemet', () => {
  let app: INestApplicationContext;
  beforeEach(async () => {
    app = await createTestingApp();
    await seedArticles([
      { raw_id: 'a1', spaces: ['fonsterputs'], urgency: 'info', relevance: 90, summary: 'Kort sammanfattning', full_text: RAW },
    ]);
  });
  afterEach(closeTestingApp);

  it('mejlet innehåller inte fulltexten', async () => {
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).toContain('Kort sammanfattning');
    expect(html).not.toContain(RAW);
  });

  it('exporten innehåller inte fulltexten, ens när hela raden efterfrågas via sort eller användare', async () => {
    let body = '';
    const res = { type: () => res, send: (b: string) => { body = b; } };
    await app.get(ExportController).articles({ user: { id: 'u-anna' } } as never, res as never, undefined, 'relevance desc');
    expect(body).toContain('Artikel a1');
    expect(body).not.toContain(RAW);
  });
});

describe('mejlrendering utan sammanfattning', () => {
  it('klarar en artikel utan sammanfattning (null) och skriver inte "null"', () => {
    const html = renderDigest([{ title: 'T', url: 'https://example.se', urgency: 'info', otherSources: [], summary: null }]);
    expect(html).toContain('T');
    expect(html).not.toContain('null');
  });
});

describe('arkitekturregel: råtext', () => {
  it('bara berikningen skriver full_text, och åtkomstmodulen nämner den bara för att undanta den', () => {
    const allowed = ['src/pipeline/enrich.service.ts', 'src/access/article-access.service.ts'];
    const offenders = globSync('src/**/*.ts', { ignore: allowed })
      .filter((file) => /full_text|fullText/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
