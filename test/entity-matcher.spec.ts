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
