import { INestApplicationContext } from '@nestjs/common';
import { ArticleAccessService } from '../src/access/article-access.service';
import { pipelineConfig } from '../src/config/pipeline.config';
import { DigestService } from '../src/digest/digest.service';
import { renderDigest } from '../src/digest/render';
import { closeTestingApp, createTestingApp, seedArticles, testKnex } from './helpers';

const rader = (html: string) => (html.match(/<tr>/g) ?? []).length;
const id = async (rawId: string): Promise<number> => (await testKnex()('articles').where({ raw_id: rawId }).first()).id;

describe('utskicksloggen: vad varje användare redan fått', () => {
  let app: INestApplicationContext;
  let access: ArticleAccessService;
  let digest: DigestService;
  beforeEach(async () => {
    app = await createTestingApp();
    access = app.get(ArticleAccessService);
    digest = app.get(DigestService);
    await seedArticles([
      { raw_id: 'a1', title: 'Första', spaces: ['takvard'], urgency: 'info', relevance: 90 },
      { raw_id: 'a2', title: 'Andra', spaces: ['takvard'], urgency: 'info', relevance: 80 },
    ]);
  });
  afterEach(closeTestingApp);

  /** Vad en användare fått, ur utgåvor, leveranser och leveransposter. */
  const levererat = (userId: string) =>
    testKnex()('delivery_items as di')
      .join('deliveries as d', 'd.id', 'di.delivery_id')
      .join('editions as e', 'e.id', 'd.edition_id')
      .where('d.user_id', userId)
      .select('di.article_id', 'd.sent_at as delivery_sent_at', 'e.status', 'e.sent_at as edition_sent_at', 'd.edition_id')
      .orderBy('di.article_id');

  it('send skickar utskicket och sparar vad som ingick, i en utgåva och en leverans', async () => {
    const sentAt = new Date('2026-10-01T07:00:00+02:00');
    const sent = await digest.send('u-kalle', sentAt);
    expect(rader(sent.html)).toBe(2);
    expect(sent.articleIds.sort()).toEqual([await id('a1'), await id('a2')].sort());

    const rows = await levererat('u-kalle');
    expect(rows.map((r) => r.article_id)).toEqual([await id('a1'), await id('a2')]);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    expect(rows.every((r) => r.delivery_sent_at.getTime() === sentAt.getTime())).toBe(true);
    expect(rows.every((r) => r.edition_sent_at.getTime() === sentAt.getTime())).toBe(true);
    expect(await testKnex()('deliveries').count<{ count: string }>('* as count').first()).toEqual({ count: '1' });
  });

  it('mottagare i samma utskick delar utgåva, och varje mottagare får en egen leverans', async () => {
    const sentAt = new Date('2026-10-01T07:00:00+02:00');
    await digest.send('u-kalle', sentAt);
    await digest.send('u-mikael', sentAt);
    expect(await testKnex()('editions').count<{ count: string }>('* as count').first()).toEqual({ count: '1' });
    expect(await testKnex()('deliveries').pluck('user_id')).toEqual(['u-kalle', 'u-mikael']);
  });

  it('ett senare utskick blir en ny utgåva', async () => {
    await digest.send('u-kalle', new Date('2026-10-01T07:00:00+02:00'));
    await seedArticles([{ raw_id: 'a3', title: 'Tredje', spaces: ['takvard'], urgency: 'info', relevance: 70 }]);
    await digest.send('u-kalle', new Date('2026-10-03T07:00:00+02:00'));
    expect(await testKnex()('editions').count<{ count: string }>('* as count').first()).toEqual({ count: '2' });
    expect((await levererat('u-kalle')).map((r) => r.article_id)).toEqual([await id('a1'), await id('a2'), await id('a3')]);
  });

  it('ett utkast till leverans (inte skickad) räknas inte som skickat', async () => {
    const knex = testKnex();
    await knex('users').insert({ id: 'u-kalle', name: 'u-kalle', role: 'reader' });
    await knex('publications').insert({ id: 'p', name: 'p', spaces: ['takvard'], schedule: 'varannan dag' });
    const [edition] = await knex('editions').insert({ publication_id: 'p', status: 'draft' }).returning('id');
    const [draft] = await knex('deliveries').insert({ edition_id: edition.id, user_id: 'u-kalle', sent_at: null }).returning('id');
    await knex('delivery_items').insert({ delivery_id: draft.id, article_id: await id('a1') });

    expect([...(await access.sentTo('u-kalle', [await id('a1')]))]).toEqual([]);
    expect([...(await access.sentToAnyone([await id('a1')]))]).toEqual([]);
    expect(await digest.compose('u-kalle')).toContain('Första');
  });

  it('compose är en förhandsvisning: den sparar ingenting och ger samma svar två gånger', async () => {
    const första = await digest.compose('u-kalle');
    expect(await digest.compose('u-kalle')).toBe(första);
    expect(await testKnex()('delivery_items').count<{ count: string }>('* as count').first()).toEqual({ count: '0' });
    expect(await testKnex()('editions').count<{ count: string }>('* as count').first()).toEqual({ count: '0' });
  });

  it('en artikel som redan skickats till användaren skickas inte igen', async () => {
    await digest.send('u-kalle');
    const nästa = await digest.send('u-kalle');
    expect(rader(nästa.html)).toBe(0);
    expect(nästa.articleIds).toEqual([]);
    await seedArticles([{ raw_id: 'a3', title: 'Tredje', spaces: ['takvard'], urgency: 'info', relevance: 70 }]);
    const dag2 = await digest.send('u-kalle');
    expect(dag2.html).toContain('Tredje');
    expect(dag2.html).not.toContain('Första');
    expect(dag2.html).not.toContain('Andra');
  });

  it('loggen gäller per användare: det som skickats till Kalle skickas ändå till Mikael', async () => {
    await digest.send('u-kalle');
    const mikael = await digest.compose('u-mikael');
    expect(mikael).toContain('Första');
    expect(mikael).toContain('Andra');
  });

  it('samma leverans sparad två gånger skapar inga dubbletter', async () => {
    const sentAt = new Date('2026-10-01T07:00:00+02:00');
    await access.recordSent('u-kalle', [await id('a1')], sentAt);
    await access.recordSent('u-kalle', [await id('a1'), await id('a2')], sentAt);
    expect((await levererat('u-kalle')).map((r) => r.article_id)).toEqual([await id('a1'), await id('a2')]);
    expect(await testKnex()('deliveries').count<{ count: string }>('* as count').first()).toEqual({ count: '1' });
    expect(await testKnex()('editions').count<{ count: string }>('* as count').first()).toEqual({ count: '1' });
  });

  it('en användare som saknas i users läggs till när den får sin första leverans', async () => {
    expect(await testKnex()('users').where({ id: 'u-kalle' })).toEqual([]);
    await digest.send('u-kalle');
    expect((await testKnex()('users').where({ id: 'u-kalle' }).first()).role).toBe('reader');
  });

  it('åtkomstmodulen svarar vilka av artiklarna en användare fått, och vilka som skickats till någon', async () => {
    const [a1, a2] = [await id('a1'), await id('a2')];
    await access.recordSent('u-kalle', [a1], new Date());
    expect([...(await access.sentTo('u-kalle', [a1, a2]))]).toEqual([a1]);
    expect([...(await access.sentTo('u-mikael', [a1, a2]))]).toEqual([]);
    expect([...(await access.sentToAnyone([a1, a2]))]).toEqual([a1]);
    expect((await access.sentToAnyone([])).size).toBe(0);
  });

  it('loggen visar aldrig något utanför omfånget: en artikel som användaren inte får se skickas inte', async () => {
    await seedArticles([{ raw_id: 'f1', title: 'Fönsterputs', spaces: ['fonsterputs'], urgency: 'info', relevance: 90 }]);
    const sent = await digest.send('u-kalle');
    expect(sent.html).not.toContain('Fönsterputs');
    expect(sent.articleIds).not.toContain(await id('f1'));
  });
});

describe('uppföljningar i utskicket', () => {
  let app: INestApplicationContext;
  let digest: DigestService;
  let access: ArticleAccessService;
  beforeEach(async () => {
    app = await createTestingApp();
    digest = app.get(DigestService);
    access = app.get(ArticleAccessService);
    await seedArticles([
      { raw_id: 'u1', title: 'Uppdaterad nyhet', spaces: ['takvard'], urgency: 'info', relevance: 80, is_followup: true },
    ]);
  });
  afterEach(closeTestingApp);

  it('skickas inte igen till den som redan fått artikeln', async () => {
    await access.recordSent('u-kalle', [await id('u1')], new Date());
    expect(rader(await digest.compose('u-kalle'))).toBe(0);
  });

  it('skickas till den som inte fått artikeln, och märks som uppföljning', async () => {
    await access.recordSent('u-kalle', [await id('u1')], new Date());
    const mikael = await digest.compose('u-mikael');
    expect(mikael).toContain('Uppdaterad nyhet');
    expect(mikael).toContain('Uppföljning');
  });

  it('en vanlig artikel märks inte som uppföljning', async () => {
    await seedArticles([{ raw_id: 'n1', title: 'Vanlig nyhet', spaces: ['takvard'], urgency: 'info', relevance: 80 }]);
    const html = await digest.compose('u-kalle');
    expect(html.match(/Uppföljning/g)).toHaveLength(1);
  });

  it('renderDigest märker bara uppföljningar', () => {
    const artikel = { title: 'T', url: 'https://example.se/a', summary: 's', urgency: 'info', otherSources: [] };
    expect(renderDigest([{ ...artikel, followUp: true }])).toContain('Uppföljning');
    expect(renderDigest([{ ...artikel, followUp: false }])).not.toContain('Uppföljning');
    expect(renderDigest([artikel])).not.toContain('Uppföljning');
  });
});

describe('rättelser ska alltid med', () => {
  let app: INestApplicationContext;
  let digest: DigestService;
  const { maxItems, threshold } = pipelineConfig.digest;
  beforeEach(async () => {
    app = await createTestingApp();
    digest = app.get(DigestService);
  });
  afterEach(closeTestingApp);

  const rättelse = (extra: Record<string, unknown> = {}) => ({
    raw_id: 'c1', title: 'Rättelse: rotavdraget', spaces: ['takvard'], urgency: 'info', relevance: 5, is_correction: true, ...extra,
  });

  it('en rättelse kommer med trots att den ligger under tröskeln', async () => {
    await seedArticles([rättelse(), { raw_id: 'n1', title: 'Låg nyhet', spaces: ['takvard'], urgency: 'info', relevance: threshold - 1 }]);
    const html = await digest.compose('u-kalle');
    expect(html).toContain('Rättelse: rotavdraget');
    expect(html).not.toContain('Låg nyhet');
  });

  it('en rättelse kommer med även när utskicket redan är fullt, och står först', async () => {
    await seedArticles([
      ...Array.from({ length: maxItems + 2 }, (_, i) => ({ raw_id: `n${i}`, title: `Nyhet ${i}`, spaces: ['takvard'], urgency: 'akut', relevance: 95 })),
      rättelse(),
    ]);
    const html = await digest.compose('u-kalle');
    expect(rader(html)).toBe(maxItems + 1);
    expect(html.indexOf('Rättelse: rotavdraget')).toBeLessThan(html.indexOf('Nyhet 0'));
  });

  it('arbetsytan är fortfarande en hård gräns: en rättelse för takvård når inte fönsterputs', async () => {
    await seedArticles([rättelse()]);
    expect(await digest.compose('u-anna')).not.toContain('Rättelse');
    expect(await digest.compose('u-kalle')).toContain('Rättelse');
  });

  it('en nekad kategori gäller även rättelser (nekat vinner)', async () => {
    await seedArticles([rättelse({ categories: ['regler'] })]);
    await testKnex()('content_scopes').where({ user_id: 'u-kalle' }).update({ deny_categories: ['regler'] });
    expect(await digest.compose('u-kalle')).not.toContain('Rättelse');
  });

  it('en rättelse som flaggats för granskning skickas inte', async () => {
    await seedArticles([rättelse({ needs_review: true, spaces: [] })]);
    expect(await digest.compose('u-kalle')).not.toContain('Rättelse');
  });

  it('en rättelse skickas bara en gång till samma användare', async () => {
    await seedArticles([rättelse()]);
    expect(await digest.send('u-kalle')).toMatchObject({ articleIds: [await id('c1')] });
    expect(rader((await digest.send('u-kalle')).html)).toBe(0);
  });

  it('en rättelse som också är en uppföljning ignorerar inte loggen men kommer med till den som inte fått den', async () => {
    await seedArticles([rättelse({ is_followup: true })]);
    await app.get(ArticleAccessService).recordSent('u-kalle', [await id('c1')], new Date());
    expect(rader(await digest.compose('u-kalle'))).toBe(0);
    expect(await digest.compose('u-mikael')).toContain('Rättelse');
  });
});
