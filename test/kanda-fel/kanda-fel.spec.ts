/**
 * Kända fel i den ärvda koden. Varje test beskriver hur systemet BORDE bete sig
 * och fallerar så länge felet finns kvar. Körs med: npm run test:kanda-fel
 *
 * När ett fel rättas flyttas testet till den vanliga testsviten.
 */
import { INestApplicationContext } from '@nestjs/common';
import { ArticleAccessService } from '../../src/access/article-access.service';
import { renderDigest } from '../../src/digest/render';
import { LlmProvider } from '../../src/llm/llm.provider';
import { StubProvider } from '../../src/llm/stub.provider';
import { EnrichService } from '../../src/pipeline/enrich.service';
import { matchEntities } from '../../src/pipeline/entity-matcher';
import { normalizeUrl } from '../../src/pipeline/normalize-url';
import { isSameStory } from '../../src/pipeline/similarity';
import { closeTestingApp, createTestingApp, seedArticles, testKnex } from '../helpers';

const konkurs = {
  id: 'r01',
  source: 'bolagsverket',
  url: 'https://poit.example.se/kungorelse/2026-123456',
  published_at: '2026-09-30T14:00:00+02:00',
  title: 'Konkursbeslut',
  text: 'Växjö tingsrätt har beslutat om konkurs för Takvårdarna i Småland AB, 556701-2233.',
};

describe('Behörighet (incidenten: Anna fick en konkursnyhet om takvård)', () => {
  let app: INestApplicationContext;
  let access: ArticleAccessService;
  beforeEach(async () => {
    app = await createTestingApp();
    access = app.get(ArticleAccessService);
  });
  afterEach(closeTestingApp);
});

describe('Pipeline', () => {
  it('fel 8: alla spårningsparametrar tas bort ur URL:en (r01 och r03 är samma kungörelse)', () => {
    expect(normalizeUrl('https://poit.example.se/kungorelse/2026-123456?utm_source=rss&utm_medium=feed'))
      .toBe('https://poit.example.se/kungorelse/2026-123456');
  });

  it('fel 9: en entitet utan domän matchar inte varje text', () => {
    const klartGlas = { id: 'e5', name: 'Klart Glas Kalmar', watchLevel: 'high' as const,
      aliases: ['Klart Glas'], domains: [''] };
    expect(matchEntities('Rekordpumpa i Nybro', [klartGlas])).toEqual([]);
  });

  it('fel 10: alias med svensk böjning matchar (Takvårdarnas)', () => {
    const tv = { id: 'e2', name: 'Takvårdarna', watchLevel: 'high' as const,
      aliases: ['Takvårdarna'], domains: ['takvardarna.se'] };
    expect(matchEntities('Takvårdarnas kunder blir utan pengar', [tv])).not.toEqual([]);
  });

  it('fel 11: två orelaterade texter räknas inte som samma story', async () => {
    const stub = new StubProvider();
    const a = await stub.embed('Rotavdraget sänks från 30 till 20 procent av arbetskostnaden för arbeten');
    const b = await stub.embed('Erik Eriksson från Nybro vann årets pumpatävling med en pumpa på 412 kilo');
    expect(isSameStory(a, b)).toBe(false);
  });
});
