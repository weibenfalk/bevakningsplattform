import { QuerySyntaxError, Token, tokenize } from '../src/query/tokenizer';

/** Kort läsbar form av tokenlistan (utan slut-token), så att testerna blir korta. */
const kort = (query: string): string[] =>
  tokenize(query)
    .filter((t) => t.type !== 'END')
    .map((t: Token) => {
      if (t.type === 'WORD') return t.text + (t.prefix ? '*' : '');
      if (t.type === 'PHRASE') return `"${t.words.map((w) => w.text + (w.prefix ? '*' : '')).join(' ')}"`;
      if (t.type === 'NEAR') return `NEAR/${t.distance}`;
      return t.type;
    });

/** Kör tokenizern och returnerar felet, eller kastar om det inte blev något fel. */
const fel = (query: string): QuerySyntaxError => {
  try {
    tokenize(query);
  } catch (e) {
    expect(e).toBeInstanceOf(QuerySyntaxError);
    return e as QuerySyntaxError;
  }
  throw new Error(`"${query}" gav inget syntaxfel`);
};

describe('tokenize: ord och operatorer', () => {
  it('delar upp ord, operatorer och parenteser', () => {
    expect(kort('(Rikstak OR Takvårdarna) AND NOT pumpa*')).toEqual([
      'LPAREN', 'Rikstak', 'OR', 'Takvårdarna', 'RPAREN', 'AND', 'NOT', 'pumpa*',
    ]);
  });

  it('en tom fråga ger bara slut-token', () => {
    expect(tokenize('')).toEqual([{ type: 'END', pos: 1 }]);
    expect(tokenize('   ')).toEqual([{ type: 'END', pos: 4 }]);
  });

  it('å, ä och ö är bokstäver och bevaras i ordet', () => {
    expect(kort('Takvårdarna börsnotering Arbetsmiljöverket ÅÄÖ')).toEqual([
      'Takvårdarna', 'börsnotering', 'Arbetsmiljöverket', 'ÅÄÖ',
    ]);
  });

  it('å, ä och ö i sammansatt form (NFD) normaliseras till vanliga tecken', () => {
    const nfd = 'börsnotering'; // o + prickar ovanför
    expect(kort(nfd)).toEqual(['börsnotering']);
  });

  it('operatorer känns bara igen med versaler: "and", "or" och "not" är vanliga ord', () => {
    expect(kort('and or not')).toEqual(['and', 'or', 'not']);
  });

  it('ett ord får innehålla siffror, bindestreck, understreck och punkt (domäner)', () => {
    expect(kort('e-post google_reviews poit.example.se 2027')).toEqual([
      'e-post', 'google_reviews', 'poit.example.se', '2027',
    ]);
  });

  it('ett ord med wildcard sist blir ett prefix', () => {
    expect(tokenize('pumpa*')[0]).toEqual({ type: 'WORD', text: 'pumpa', prefix: true, pos: 1 });
  });

  it('AND följt av * är ett ord med wildcard, inte en operator', () => {
    expect(tokenize('AND*')[0]).toMatchObject({ type: 'WORD', text: 'AND', prefix: true });
  });

  it('fält och kolon blir egna tokens', () => {
    expect(kort('title:Rikstak')).toEqual(['title', 'COLON', 'Rikstak']);
  });

  it('varje token får sin position (räknat från 1)', () => {
    expect(tokenize('a OR  b').map((t) => t.pos)).toEqual([1, 3, 7, 8]);
  });
});

describe('tokenize: fraser', () => {
  it('en fras blir en token med sina ord', () => {
    expect(kort('"Rena Fönster"')).toEqual(['"Rena Fönster"']);
  });

  it('operatorer inne i en fras är vanliga ord', () => {
    expect(kort('"bygg AND tak"')).toEqual(['"bygg AND tak"']);
  });

  it('en fras får ha wildcard sist i varje ord', () => {
    expect(kort('"fönster put*"')).toEqual(['"fönster put*"']);
  });

  it('en fras som aldrig stängs ger fel vid det inledande citattecknet', () => {
    const e = fel('Rikstak "Rena Fönster');
    expect(e.position).toBe(9);
    expect(e.message).toMatch(/citattecknet/i);
  });

  it('en tom fras är ett fel', () => {
    const e = fel('"  "');
    expect(e.position).toBe(1);
    expect(e.message).toMatch(/tom/i);
  });

  it('ett otillåtet tecken i en fras pekar ut tecknet', () => {
    const e = fel('"tak (pris)"');
    expect(e.position).toBe(6);
    expect(e.message).toContain('(');
  });
});

describe('tokenize: NEAR/n', () => {
  it('NEAR/3 blir en token med avstånd', () => {
    expect(kort('Rikstak NEAR/3 pris')).toEqual(['Rikstak', 'NEAR/3', 'pris']);
  });

  it('NEAR utan snedstreck är ett vanligt ord', () => {
    expect(kort('NEAR')).toEqual(['NEAR']);
  });

  it('NEAR/ utan siffra är ett fel', () => {
    expect(fel('a NEAR/ b').position).toBe(3);
    expect(fel('a NEAR/x b').message).toMatch(/siffra/);
  });

  it('NEAR/0 är ett fel, eftersom två ord inte kan vara noll ord ifrån varandra', () => {
    expect(fel('a NEAR/0 b').message).toMatch(/minst 1/);
  });

  it('text direkt efter siffran (NEAR/3x) är ett fel', () => {
    expect(fel('a NEAR/3x b').position).toBe(3);
  });
});

describe('tokenize: felaktig syntax', () => {
  it('wildcard först i ett ord (pf-puts) pekar på stjärnan', () => {
    const e = fel('*putsning OR fallskydd');
    expect(e.position).toBe(1);
    expect(e.message).toMatch(/wildcard/i);
    expect(e.message).toMatch(/sist/);
  });

  it('wildcard mitt i ett ord pekar på stjärnan', () => {
    const e = fel('put*sning');
    expect(e.position).toBe(4);
    expect(e.message).toMatch(/wildcard/i);
  });

  it('en ensam stjärna och dubbla stjärnor är fel', () => {
    expect(fel('*').position).toBe(1);
    expect(fel('tak**').position).toBe(4);
  });

  it('wildcard först i ett ord i en fras är fel', () => {
    expect(fel('"a *b"').position).toBe(4);
  });

  it('ett okänt tecken pekar ut tecknet', () => {
    const e = fel('tak & pris');
    expect(e.position).toBe(5);
    expect(e.message).toContain('&');
  });

  it('ett ord får inte börja med bindestreck (det är inte NOT)', () => {
    expect(fel('-pumpa').position).toBe(1);
  });

  it('snedstreck utanför NEAR är ett fel', () => {
    expect(fel('tak/pris').position).toBe(4);
  });

  it('typografiska citattecken är ett fel med tydlig position', () => {
    expect(fel('“tak”').position).toBe(1);
  });

  it('felmeddelandet innehåller positionen', () => {
    expect(fel('tak & pris').message).toContain('position 5');
  });
});
