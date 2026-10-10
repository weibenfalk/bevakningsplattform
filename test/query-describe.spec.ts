import { explain, termText } from '../src/query/evaluator';
import { errorMarker, tokenLines, treeLines } from '../src/query/describe';
import { parse } from '../src/query/parser';
import { QuerySyntaxError, tokenize } from '../src/query/tokenizer';

describe('tokenLines', () => {
  it('en token per rad med position och typ', () => {
    expect(tokenLines(tokenize('(a OR "b c") NEAR/2 d*'))).toEqual([
      '1   LPAREN',
      '2   WORD a',
      '4   OR',
      '7   PHRASE "b c"',
      '12  RPAREN',
      '14  NEAR/2',
      '21  WORD d*',
      '23  END',
    ]);
  });
});

describe('treeLines', () => {
  it('indenterar trädet, två blanksteg per nivå', () => {
    expect(treeLines(parse('(Rikstak OR "Rena Fönster") AND NOT pumpa*'))).toEqual([
      'AND',
      '  OR',
      '    TERM Rikstak',
      '    TERM "Rena Fönster"',
      '  NOT',
      '    TERM pumpa*',
    ]);
  });

  it('visar fält och NEAR', () => {
    expect(treeLines(parse('title:a NEAR/3 b'))).toEqual(['TERM title:a NEAR/3 b']);
  });
});

describe('termText', () => {
  it('skriver en term som den kan läsas i frågan', () => {
    const node = parse('entity:"Rena Fönster"');
    expect(node.type === 'term' && termText(node)).toBe('entity:"Rena Fönster"');
  });
});

describe('explain: vilka termer gav träffen', () => {
  const art = { title: 'Rikstak köper takfirma', body: 'Rikstak och Takvårdarna' };
  const termer = (q: string) => explain(parse(q), art);

  it.each([
    ['OR ger bara de grenar som träffade', 'Rikstak OR Sydkust OR Takvårdarna', ['Rikstak', 'Takvårdarna']],
    ['AND ger alla termer', 'Rikstak AND takfirma', ['Rikstak', 'takfirma']],
    ['NOT bidrar inte med någon term', 'Rikstak AND NOT Sydkust', ['Rikstak']],
    ['en artikel som inte träffar ger ingen term', 'Sydkust', []],
    ['NEAR visas som en term', 'Rikstak NEAR/2 köper', ['Rikstak NEAR/2 köper']],
  ])('%s', (_namn, fråga, förväntat) => {
    expect(termer(fråga)).toEqual(förväntat);
  });
});

describe('errorMarker', () => {
  it('visar frågan, en markering under positionen och meddelandet', () => {
    const query = '*putsning OR fallskydd';
    try {
      parse(query);
    } catch (e) {
      expect(errorMarker(query, e as QuerySyntaxError)).toEqual([query, '^', (e as QuerySyntaxError).message]);
      return;
    }
    throw new Error('borde ha kastat');
  });

  it('markeringen hamnar under rätt tecken', () => {
    const query = 'tak & pris';
    try {
      parse(query);
    } catch (e) {
      expect(errorMarker(query, e as QuerySyntaxError)[1]).toBe('    ^');
      return;
    }
    throw new Error('borde ha kastat');
  });

  it('fel i slutet pekar strax efter sista tecknet', () => {
    try {
      parse('a AND');
    } catch (e) {
      expect(errorMarker('a AND', e as QuerySyntaxError)[1]).toBe('     ^');
      return;
    }
    throw new Error('borde ha kastat');
  });
});
