import { Node, Word, parse } from '../src/query/parser';
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
  it('ett ord', () => {
    expect(parse('Rikstak')).toEqual(term(w('Rikstak')));
  });

  it('ett ord med wildcard (prefix)', () => {
    expect(parse('pumpa*')).toEqual(term(pre('pumpa')));
  });

  it('en fras', () => {
    expect(parse('"Rena Fönster"')).toEqual(term(w('Rena'), w('Fönster')));
  });

  it('AND', () => {
    expect(parse('a AND b')).toEqual(och(term(w('a')), term(w('b'))));
  });

  it('implicit AND ger samma träd som AND', () => {
    expect(parse('a b c')).toEqual(parse('a AND b AND c'));
  });

  it('OR', () => {
    expect(parse('a OR b OR c')).toEqual(eller(term(w('a')), term(w('b')), term(w('c'))));
  });

  it('AND binder hårdare än OR', () => {
    expect(parse('a OR b AND c')).toEqual(eller(term(w('a')), och(term(w('b')), term(w('c')))));
    expect(parse('a AND b OR c')).toEqual(eller(och(term(w('a')), term(w('b'))), term(w('c'))));
  });

  it('implicit AND binder också hårdare än OR', () => {
    expect(parse('a b OR c')).toEqual(eller(och(term(w('a')), term(w('b'))), term(w('c'))));
  });

  it('parenteser ändrar ordningen', () => {
    expect(parse('(a OR b) AND c')).toEqual(och(eller(term(w('a')), term(w('b'))), term(w('c'))));
  });

  it('inbäddade parenteser', () => {
    expect(parse('(a AND (b OR c))')).toEqual(och(term(w('a')), eller(term(w('b')), term(w('c')))));
  });

  it('NOT gäller bara nästa atom', () => {
    expect(parse('a AND NOT b')).toEqual(och(term(w('a')), inte(term(w('b')))));
    expect(parse('NOT a b')).toEqual(och(inte(term(w('a'))), term(w('b'))));
  });

  it('NOT framför en parentes', () => {
    expect(parse('NOT (a OR b)')).toEqual(inte(eller(term(w('a')), term(w('b')))));
  });

  it('implicit AND före NOT', () => {
    expect(parse('a NOT b')).toEqual(och(term(w('a')), inte(term(w('b')))));
  });

  it('fält på ord och fras', () => {
    expect(parse('title:Rikstak')).toEqual({ type: 'term', field: 'title', words: [w('Rikstak')] });
    expect(parse('entity:"Rena Fönster"')).toEqual({ type: 'term', field: 'entity', words: [w('Rena'), w('Fönster')] });
  });

  it('alla tio fälten är tillåtna, även med versaler', () => {
    for (const field of ['title', 'body', 'source', 'domain', 'entity', 'category', 'author', 'region', 'lang', 'area']) {
      expect(parse(`${field}:x`)).toMatchObject({ type: 'term', field });
      expect(parse(`${field.toUpperCase()}:x`)).toMatchObject({ type: 'term', field });
    }
  });

  it('fält med wildcard i värdet', () => {
    expect(parse('domain:poit*')).toEqual({ type: 'term', field: 'domain', words: [pre('poit')] });
  });

  it('NEAR/n mellan två ord', () => {
    expect(parse('Rikstak NEAR/3 pris')).toEqual({
      type: 'near', field: null, left: [w('Rikstak')], right: [w('pris')], distance: 3,
    });
  });

  it('NEAR/n mellan fraser och ord med wildcard, med fält', () => {
    expect(parse('body:"Rena Fönster" NEAR/10 konkurs*')).toEqual({
      type: 'near', field: 'body', left: [w('Rena'), w('Fönster')], right: [pre('konkurs')], distance: 10,
    });
  });

  it('NEAR ingår i större uttryck', () => {
    expect(parse('a NEAR/2 b AND c')).toEqual(
      och({ type: 'near', field: null, left: [w('a')], right: [w('b')], distance: 2 }, term(w('c'))),
    );
  });

  it('en enda operator i en parentes ger inget extra lager', () => {
    expect(parse('((a))')).toEqual(term(w('a')));
  });

  it('extra blanksteg och radbrytningar spelar ingen roll', () => {
    expect(parse('  a \n AND\tb ')).toEqual(parse('a AND b'));
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

  it('en inre oparad parentes pekar på den inre', () => {
    expect(fel('(a AND (b OR c').position).toBe(8);
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

  it('operator utan vänstra operand', () => {
    expect(fel('OR a').position).toBe(1);
    expect(fel('AND a').position).toBe(1);
  });

  it('två operatorer i rad', () => {
    const e = fel('a AND OR b');
    expect(e.position).toBe(7);
    expect(e.message).toContain('OR');
  });

  it('NOT får inte följas av NOT (grammatiken har högst ett NOT)', () => {
    expect(fel('NOT NOT a').position).toBe(5);
  });

  it('NOT utan operand', () => {
    expect(fel('a AND NOT').position).toBe(10);
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

  it('fält följt av parentes är inte tillåtet', () => {
    expect(fel('title:(a OR b)').position).toBe(7);
  });

  it('fält med wildcard (title*:x) är ett fel', () => {
    expect(fel('title*:x').message).toMatch(/fält/i);
  });

  it('ensamt kolon', () => {
    expect(fel('a : b').position).toBe(1); // "a" tolkas som fält och är inte ett känt fält
    expect(fel(':a').position).toBe(1);
  });

  it('NEAR utan vänster eller höger operand', () => {
    expect(fel('NEAR/2 a').position).toBe(1);
    expect(fel('a NEAR/2').position).toBe(9);
  });

  it('NEAR kan inte kedjas (grammatiken har bara två operander)', () => {
    const e = fel('a NEAR/2 b NEAR/3 c');
    expect(e.position).toBe(12);
    expect(e.message).toContain('NEAR/3');
  });

  it('NEAR mellan parenteser är inte tillåtet', () => {
    expect(fel('a NEAR/2 (b OR c)').position).toBe(10);
  });

  it('syntaxfel från tokenizern kommer också ut ur parse', () => {
    expect(fel('*putsning OR fallskydd').position).toBe(1);
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
