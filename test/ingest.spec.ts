import { INestApplicationContext } from '@nestjs/common';
import { parsePublished, prepareItem, repairEncoding } from '../src/pipeline/ingest';
import { closeTestingApp, createTestingApp, installLlm, scriptedLlm, testKnex } from './helpers';

describe('repairEncoding (UTF-8 lästa som Latin-1)', () => {
  it.each([
    ['FÃ¶nster', 'Fönster'],
    ['Blanka FÃ¶nster AB Ã¶ppnar kontor i VÃ¤xjÃ¶ och anstÃ¤ller tio personer.', 'Blanka Fönster AB öppnar kontor i Växjö och anställer tio personer.'],
    ['Ã…ngermanland och Ã–rebro', 'Ångermanland och Örebro'],
    ['Ã„ngelholm', 'Ängelholm'],
  ])('%s repareras', (broken, fixed) => {
    expect(repairEncoding(broken)).toEqual({ text: fixed, repaired: true, suspicious: false });
  });

  it('korrekt text lämnas orörd', () => {
    for (const ok of ['Fönster i Växjö', 'Åre, Örebro, Ängelholm', 'plain ascii', '']) {
      expect(repairEncoding(ok)).toEqual({ text: ok, repaired: false, suspicious: false });
    }
  });

  it('text som ser felkodad ut men inte går att reparera lämnas orörd och markeras som misstänkt', () => {
    expect(repairEncoding('Ã ensam')).toEqual({ text: 'Ã ensam', repaired: false, suspicious: true });
  });
});

describe('parsePublished (tid utan tidszon är Europe/Stockholm)', () => {
  it.each([
    ['2026-09-30 23:30:00', '2026-09-30T21:30:00.000Z'], // sommartid, +02:00 (r21)
    ['2026-09-30T23:30:00', '2026-09-30T21:30:00.000Z'],
    ['2026-12-15 10:00:00', '2026-12-15T09:00:00.000Z'], // normaltid, +01:00
    ['2026-09-30 23:30', '2026-09-30T21:30:00.000Z'],
    ['2026-09-30', '2026-09-29T22:00:00.000Z'],
  ])('%s tolkas som svensk tid', (input, expected) => {
    expect(parsePublished(input)).toBe(expected);
  });

  it.each([
    ['2026-09-30T14:00:00+02:00', '2026-09-30T12:00:00.000Z'],
    ['2026-09-30T14:00:00Z', '2026-09-30T14:00:00.000Z'],
    ['2026-12-15T10:00:00-05:00', '2026-12-15T15:00:00.000Z'],
  ])('%s med tidszon behåller sin tidszon', (input, expected) => {
    expect(parsePublished(input)).toBe(expected);
  });

  it.each(['igår', '', '2026-13-45 99:99:99', '30/9 2026'])('%j ger null', (input) => {
    expect(parsePublished(input)).toBeNull();
  });
});

describe('prepareItem', () => {
  const item = { id: 'x', source: 'smhi', url: 'https://example.se/x', published_at: '2026-09-30 23:30:00', title: 'T', text: 't' };

  it('rapporterar problem i stället för att tiga', () => {
    expect(prepareItem({ ...item, published_at: 'igår' }).problems).toEqual(['Ogiltigt datum: "igår"']);
    expect(prepareItem({ ...item, text: 'Ã ensam' }).problems).toEqual(['Misstänkt felkodad text']);
    expect(prepareItem(item).problems).toEqual([]);
  });
});

describe('pipelinen: teckenkodning och tidszon', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  const enrich = () => installLlm(app, scriptedLlm({ enrich: {
    summary: 's', business_areas: ['fonsterputs'], categories: ['konkurrent'], urgency: 'info', impact: 80, confidence: 0.9,
  } }));
  const NOW = new Date('2026-10-01T07:00:00+02:00');
  const raw = { id: 'r20', source: 'barometern', url: 'https://example.se/r20', published_at: '2026-09-30T10:00:00+02:00',
    title: 'Blanka FÃ¶nster expanderar', text: 'Blanka FÃ¶nster AB Ã¶ppnar kontor i VÃ¤xjÃ¶.' };

  it('r20: felkodad text repareras, sparas rätt och matchar sin entitet', async () => {
    await testKnex()('entities').insert({ name: 'Blanka Fönster AB', watch_level: 'normal', aliases: ['Blanka Fönster'], domains: [] });
    await enrich().run([raw], NOW);
    const row = await testKnex()('articles').where({ raw_id: 'r20' }).first();
    expect(row.title).toBe('Blanka Fönster expanderar');
    expect(row.full_text).toBe('Blanka Fönster AB öppnar kontor i Växjö.');
    expect(row.entity_ids).toHaveLength(1);
    expect(row.needs_review).toBe(false);
  });

  it('r21: tid utan tidszon sparas som svensk tid', async () => {
    await enrich().run([{ ...raw, id: 'r21', title: 'Spindelsanering', text: 'x', published_at: '2026-09-30 23:30:00' }], NOW);
    const row = await testKnex()('articles').where({ raw_id: 'r21' }).first();
    expect(row.published_at.toISOString()).toBe('2026-09-30T21:30:00.000Z');
  });

  it('ett ogiltigt datum kraschar inte körningen, utan flaggar artikeln och publicerar den inte', async () => {
    await enrich().run([{ ...raw, id: 'bad', title: 'Ok', text: 'Ok', published_at: 'igår' }], NOW);
    const row = await testKnex()('articles').where({ raw_id: 'bad' }).first();
    expect(row.needs_review).toBe(true);
    expect(row.spaces).toEqual([]);
    expect(row.published_at).toBeNull();
    expect(row.review_reason).toMatch(/datum/i);
  });
});

describe('prepareItem: updated_at', () => {
  const base = { id: 'x', source: 's', url: 'https://example.se/x', published_at: '2026-09-30T18:30:00+02:00', title: 't', text: 'x' };

  it('saknas updated_at förblir det okänt', () => {
    expect(prepareItem(base).item.updated_at).toBeUndefined();
  });

  it('en tid med zon tolkas som den är, och en tid utan zon som svensk tid', () => {
    expect(prepareItem({ ...base, updated_at: '2026-10-01T12:00:00+02:00' }).item.updated_at).toBe('2026-10-01T10:00:00.000Z');
    expect(prepareItem({ ...base, updated_at: '2026-10-01 12:00:00' }).item.updated_at).toBe('2026-10-01T10:00:00.000Z');
  });

  it('ett ogiltigt updated_at rapporteras som problem och blir inte en tid', () => {
    const { item, problems } = prepareItem({ ...base, updated_at: 'igår' });
    expect(item.updated_at).toBeUndefined();
    expect(problems).toEqual(['Ogiltigt datum i updated_at: "igår"']);
  });
});
