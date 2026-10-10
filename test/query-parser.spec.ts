import { Field, Node, Word, parse } from '../src/query/parser';
import { QuerySyntaxError } from '../src/query/tokenizer';

// Små hjälpfunktioner som bygger förväntade träd.
const w = (text: string): Word => ({ text, prefix: false });
const pre = (text: string): Word => ({ text, prefix: true });
const term = (...words: Word[]): Node => ({ type: 'term', field: null, words });
const och = (...children: Node[]): Node => ({ type: 'and', children });
const eller = (...children: Node[]): Node => ({ type: 'or', children });
const inte = (child: Node): Node => ({ type: 'not', child });

const fel = (query: string): QuerySyntaxError => {
  try {
    parse(query);
  } catch (e) {
    expect(e).toBeInstanceOf(QuerySyntaxError);
    return e as QuerySyntaxError;
  }
  throw new Error(`"${query}" gav inget syntaxfel`);
};

describe('parse: giltiga frågor', () => {
  const near = (left: Word[], right: Word[], distance: number, field: Field | null = null): Node => ({ type: 'near', field, left, right, distance });
  const fält = (field: Field, ...words: Word[]): Node => ({ type: 'term', field, words });

  it.each<[string, string, Node]>([
    ['ett ord', 'Rikstak', term(w('Rikstak'))],
    ['ett ord med wildcard (prefix)', 'pumpa*', term(pre('pumpa'))],
    ['en fras', '"Rena Fönster"', term(w('Rena'), w('Fönster'))],
    ['AND', 'a AND b', och(term(w('a')), term(w('b')))],
    ['OR', 'a OR b OR c', eller(term(w('a')), term(w('b')), term(w('c')))],
    ['AND binder hårdare än OR (OR först)', 'a OR b AND c', eller(term(w('a')), och(term(w('b')), term(w('c'))))],
    ['AND binder hårdare än OR (AND först)', 'a AND b OR c', eller(och(term(w('a')), term(w('b'))), term(w('c')))],
    ['implicit AND binder också hårdare än OR', 'a b OR c', eller(och(term(w('a')), term(w('b'))), term(w('c')))],
    ['parenteser ändrar ordningen', '(a OR b) AND c', och(eller(term(w('a')), term(w('b'))), term(w('c')))],
    ['inbäddade parenteser', '(a AND (b OR c))', och(term(w('a')), eller(term(w('b')), term(w('c'))))],
    ['en enda operator i en parentes ger inget extra lager', '((a))', term(w('a'))],
    ['NOT gäller bara nästa atom (efter AND)', 'a AND NOT b', och(term(w('a')), inte(term(w('b'))))],
    ['NOT gäller bara nästa atom (först)', 'NOT a b', och(inte(term(w('a'))), term(w('b')))],
    ['NOT framför en parentes', 'NOT (a OR b)', inte(eller(term(w('a')), term(w('b'))))],
    ['implicit AND före NOT', 'a NOT b', och(term(w('a')), inte(term(w('b'))))],
    ['fält på ord', 'title:Rikstak', fält('title', w('Rikstak'))],
    ['fält på fras', 'entity:"Rena Fönster"', fält('entity', w('Rena'), w('Fönster'))],
    ['fält med wildcard i värdet', 'domain:poit*', fält('domain', pre('poit'))],
    ['NEAR/n mellan två ord', 'Rikstak NEAR/3 pris', near([w('Rikstak')], [w('pris')], 3)],
    ['NEAR/n mellan fraser och ord med wildcard, med fält', 'body:"Rena Fönster" NEAR/10 konkurs*', near([w('Rena'), w('Fönster')], [pre('konkurs')], 10, 'body')],
    ['NEAR ingår i större uttryck', 'a NEAR/2 b AND c', och(near([w('a')], [w('b')], 2), term(w('c')))],
  ])('%s', (_namn, fråga, träd) => {
    expect(parse(fråga)).toEqual(träd);
  });

  it.each([
    ['implicit AND ger samma träd som AND', 'a b c', 'a AND b AND c'],
    ['extra blanksteg och radbrytningar spelar ingen roll', '  a \n AND\tb ', 'a AND b'],
  ])('%s', (_namn, fråga, likvärdig) => {
    expect(parse(fråga)).toEqual(parse(likvärdig));
  });

  it('alla tio fälten är tillåtna, även med versaler', () => {
    for (const field of ['title', 'body', 'source', 'domain', 'entity', 'category', 'author', 'region', 'lang', 'area']) {
      expect(parse(`${field}:x`)).toMatchObject({ type: 'term', field });
      expect(parse(`${field.toUpperCase()}:x`)).toMatchObject({ type: 'term', field });
    }
  });
});

describe('parse: felaktig syntax', () => {
  it('tom fråga', () => {
    expect(fel('').message).toMatch(/tom/i);
    expect(fel('   ').message).toMatch(/tom/i);
  });

  it('oparad vänsterparentes pekar på den parentes som aldrig stängs (pf-tak-pris)', () => {
    const e = fel('(Rikstak AND (takmålning OR taktvätt)');
    expect(e.position).toBe(1);
    expect(e.message).toMatch(/parentes/i);
    expect(e.message).toMatch(/stängs aldrig/);
  });

  it('oparad högerparentes', () => {
    const e = fel('a AND b)');
    expect(e.position).toBe(8);
    expect(e.message).toMatch(/\)/);
  });

  it('tomma parenteser', () => {
    const e = fel('a AND ()');
    expect(e.position).toBe(8);
    expect(e.message).toMatch(/hittade/);
  });

  it('operator utan högra operand: slutet av frågan', () => {
    const e = fel('Rikstak AND');
    expect(e.position).toBe(12);
    expect(e.message).toMatch(/slutet av frågan/);
  });

  it('två operatorer i rad', () => {
    const e = fel('a AND OR b');
    expect(e.position).toBe(7);
    expect(e.message).toContain('OR');
  });

  it('okänt fält ger fältets position och listar de tillåtna', () => {
    const e = fel('a AND titel:tak');
    expect(e.position).toBe(7);
    expect(e.message).toContain('titel');
    expect(e.message).toContain('title, body, source, domain, entity, category, author, region, lang, area');
  });

  it('fält utan värde', () => {
    const e = fel('title:');
    expect(e.position).toBe(7);
    expect(e.message).toContain('title:');
  });

  it('fält med wildcard (title*:x) är ett fel', () => {
    expect(fel('title*:x').message).toMatch(/fält/i);
  });

  it('NEAR kan inte kedjas (grammatiken har bara två operander)', () => {
    const e = fel('a NEAR/2 b NEAR/3 c');
    expect(e.position).toBe(12);
    expect(e.message).toContain('NEAR/3');
  });


  it.each([
    ['en inre oparad parentes pekar på den inre', '(a AND (b OR c', 8],
    ['OR utan vänstra operand', 'OR a', 1],
    ['AND utan vänstra operand', 'AND a', 1],
    ['NOT får inte följas av NOT (grammatiken har högst ett NOT)', 'NOT NOT a', 5],
    ['NOT utan operand', 'a AND NOT', 10],
    ['fält följt av parentes är inte tillåtet', 'title:(a OR b)', 7],
    ['ensamt kolon efter ett ord (ordet tolkas som okänt fält)', 'a : b', 1],
    ['ensamt kolon först', ':a', 1],
    ['NEAR utan vänster operand', 'NEAR/2 a', 1],
    ['NEAR utan höger operand', 'a NEAR/2', 9],
    ['NEAR mellan parenteser är inte tillåtet', 'a NEAR/2 (b OR c)', 10],
    ['syntaxfel från tokenizern kommer också ut ur parse', '*putsning OR fallskydd', 1],
  ])('%s', (_namn, fråga, position) => {
    expect(fel(fråga).position).toBe(position);
  });
});

describe('parse: begränsa vilka fält som får användas', () => {
  const stod = ['title', 'body'] as const;
  const felMed = (query: string): QuerySyntaxError => {
    try {
      parse(query, { fields: stod });
    } catch (e) {
      expect(e).toBeInstanceOf(QuerySyntaxError);
      return e as QuerySyntaxError;
    }
    throw new Error(`"${query}" gav inget syntaxfel`);
  };

  it('ett fält som inte stöds ger ett tydligt fel med fältets position', () => {
    const e = felMed('a AND NOT lang:en');
    expect(e.position).toBe(11);
    expect(e.message).toContain('Fältet lang stöds inte än');
    expect(e.message).toContain('Stödda fält: title, body');
  });

  it('felet gäller också inom parenteser och NEAR', () => {
    expect(felMed('(a OR author:Berg)').position).toBe(7);
    expect(felMed('region:Kalmar NEAR/2 tak').message).toContain('Fältet region stöds inte än');
  });

  it('fält som stöds går igenom, och utan begränsning går alla fält igenom', () => {
    expect(() => parse('title:a AND body:b', { fields: stod })).not.toThrow();
    expect(() => parse('lang:en')).not.toThrow();
  });

  it('ett okänt fält ger fortfarande felet om okänt fält, inte om stöd', () => {
    expect(felMed('titel:a').message).toContain('Okänt fält');
  });
});
