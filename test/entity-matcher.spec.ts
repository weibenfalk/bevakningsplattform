import { matchEntities } from '../src/pipeline/entity-matcher';

const entity = (extra: Record<string, unknown> = {}) => ({
  id: 'e1', name: 'Klart Glas Kalmar', watchLevel: 'high' as const, aliases: ['Klart Glas'], domains: ['klartglas.se'], ...extra,
});

describe('matchEntities: tomma termer', () => {
  it('en entitet utan domän ("") matchar inte varje text', () => {
    expect(matchEntities('Rekordpumpa i Nybro', [entity({ domains: [''] })])).toEqual([]);
  });

  it('ett tomt alias matchar inte varje text', () => {
    expect(matchEntities('Rekordpumpa i Nybro', [entity({ aliases: [''] })])).toEqual([]);
  });

  it('en term med bara blanksteg matchar inte', () => {
    expect(matchEntities('Rekordpumpa i Nybro', [entity({ aliases: ['  '], domains: ['\t'] })])).toEqual([]);
  });

  it('riktiga termer matchar fortfarande, även när entiteten också har tomma', () => {
    const hits = matchEntities('Klart Glas öppnar i Kalmar', [entity({ domains: [''] })]);
    expect(hits.map((h) => h.term)).toEqual(['Klart Glas']);
  });
});

describe('matchEntities: ordgränser och böjning', () => {
  const tv = entity({ id: 'e2', name: 'Takvårdarna', aliases: ['Takvårdarna'], domains: ['takvardarna.se'] });
  const hit = (text: string, e = tv) => matchEntities(text, [e]).length > 0;

  it('fel 10: alias med genitiv-s matchar (Takvårdarnas)', () => {
    expect(hit('Takvårdarnas kunder blir utan pengar')).toBe(true);
    expect(hit('Takvårdarna och Takvårdarnas kunder')).toBe(true);
  });

  it('andra ändelser och sammansättningar matchar inte', () => {
    expect(hit('Takvårdarnasson')).toBe(false);
    expect(hit('Takvårdarnaz')).toBe(false);
    expect(hit('SuperTakvårdarna')).toBe(false);
  });

  it('å, ä och ö räknas som bokstäver i ordgränserna', () => {
    const husfixarna = entity({ aliases: ['Husfixarna'], domains: [] });
    expect(hit('Åhusfixarna', husfixarna)).toBe(false);
    expect(hit('Husfixarnaö', husfixarna)).toBe(false);
    expect(hit('Där finns Husfixarna.', husfixarna)).toBe(true);
    expect(hit('Öland Tak öppnar', entity({ aliases: ['Öland Tak'], domains: [] }))).toBe(true);
    expect(hit('Besök Kalmar Å i dag', entity({ aliases: ['Kalmar Å'], domains: [] }))).toBe(true);
    expect(hit('Besök Kalmar Åland', entity({ aliases: ['Kalmar Å'], domains: [] }))).toBe(false);
  });

  it('alias matchas skiftlägeskänsligt, så att vanliga ord inte träffar varumärket (r08, r15, r18)', () => {
    const rena = entity({ aliases: ['Rena Fönster'], domains: [] });
    const klart = entity({ aliases: ['Klart Glas'], domains: [] });
    const takteam = entity({ aliases: ['Tak Team'], domains: [] });
    expect(hit('Rena fönster på tio minuter med bara vatten', rena)).toBe(false);
    expect(hit('Nu har vi klart glas i hela växthuset igen.', klart)).toBe(false);
    expect(hit('Grannen anlitade ett tak team från Polen.', takteam)).toBe(false);
    expect(hit('Rena Fönster öppnar i Kalmar', rena)).toBe(true);
    expect(hit('Klart Glas Kalmar vann upphandlingen', klart)).toBe(true);
    expect(hit('Tak Team har en ny chef', takteam)).toBe(true);
  });

  it('domäner matchas däremot oberoende av skiftläge', () => {
    expect(hit('Läs mer på Takvardarna.SE/priser')).toBe(true);
    expect(hit('Mejla info@takvardarna.se')).toBe(true);
    expect(hit('xtakvardarna.se')).toBe(false);
  });

  it('flera blanksteg och radbrytningar inuti ett flerordsalias spelar ingen roll', () => {
    const rena = entity({ aliases: ['Rena Fönster'], domains: [] });
    expect(hit('Rena  Fönster', rena)).toBe(true);
    expect(hit('Rena\nFönster', rena)).toBe(true);
  });

  it('specialtecken i ett alias tolkas som text', () => {
    const e = entity({ aliases: ['A.B. (Sverige)'], domains: [] });
    expect(hit('Bolaget A.B. (Sverige) växer', e)).toBe(true);
    expect(hit('Bolaget AxBx (Sverige) växer', e)).toBe(false);
  });

  it('träffen ger rätt term, position och säkerhet', () => {
    const [m] = matchEntities('Nyheter: Takvårdarnas konkurs', [tv]);
    expect(m).toMatchObject({ entityId: 'e2', term: 'Takvårdarna', index: 9, confidence: 0.9 });
  });
});

