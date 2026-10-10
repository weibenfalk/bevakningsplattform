import { Article, matches, splitWords } from '../src/query/evaluator';
import { parse } from '../src/query/parser';

const traff = (query: string, article: Article): boolean => matches(parse(query), article);
const text = (body: string, extra: Article = {}): Article => ({ title: '', body, ...extra });

describe('splitWords', () => {
  it('delar på skiljetecken och gör gemener, med å, ä och ö bevarade', () => {
    expect(splitWords('Rikstak köper, Takvårdarna (Växjö)!')).toEqual(['rikstak', 'köper', 'takvårdarna', 'växjö']);
  });

  it('punkt i slutet av en mening hör inte till ordet, men punkt i en domän gör det', () => {
    expect(splitWords('Gå till poit.example.se. Sedan hem.')).toEqual(['gå', 'till', 'poit.example.se', 'sedan', 'hem']);
  });

  it('ger tom lista för tom text', () => {
    expect(splitWords('')).toEqual([]);
  });
});

describe('matches: ord och fraser', () => {
  it('ett ord matchar hela ord, oberoende av skiftläge', () => {
    expect(traff('rikstak', text('Erik Eriksson, vd på Rikstak, bekräftar'))).toBe(true);
    expect(traff('RIKSTAK', text('Rikstak'))).toBe(true);
  });

  it('ett ord matchar inte en del av ett ord (ingen sammansättning delas)', () => {
    expect(traff('tak', text('Rikstak och takfirma'))).toBe(false);
    expect(traff('pumpa', text('Rekordpumpa'))).toBe(false);
  });

  it('taktvätt träffar aldrig "tvätt av tak"', () => {
    expect(traff('taktvätt', text('Vi erbjuder tvätt av tak'))).toBe(false);
    expect(traff('taktvätt', text('Vi erbjuder taktvätt'))).toBe(true);
  });

  it('å, ä och ö bevaras: o matchar inte ö, och a matchar inte å', () => {
    expect(traff('Fonster', text('Rena Fönster'))).toBe(false);
    expect(traff('Fönster', text('Rena Fönster'))).toBe(true);
    expect(traff('Takvardarna', text('Takvårdarna'))).toBe(false);
  });

  it('versaler och gemener av å, ä och ö är samma bokstav', () => {
    expect(traff('ÖSTERSUND', text('östersund'))).toBe(true);
    expect(traff('växjö', text('VÄXJÖ'))).toBe(true);
  });

  it('wildcard är ett prefix och matchar noll eller fler tecken', () => {
    expect(traff('pumpa*', text('årets pumpatävling'))).toBe(true);
    expect(traff('pumpa*', text('en pumpa'))).toBe(true);
    expect(traff('pumpa*', text('Rekordpumpa'))).toBe(false);
    expect(traff('rotavdrag*', text('Rotavdraget sänks'))).toBe(true);
  });

  it('en fras kräver orden i följd och i ordning', () => {
    expect(traff('"Rena Fönster"', text('Rena Fönster var här'))).toBe(true);
    expect(traff('"Rena Fönster"', text('Rena och fina Fönster'))).toBe(false);
    expect(traff('"Rena Fönster"', text('Fönster Rena'))).toBe(false);
  });

  it('wildcard i fras gäller ordet där den står', () => {
    expect(traff('"rena fönster*"', text('rena fönsterputsare'))).toBe(true);
    expect(traff('"ren* fönster"', text('rena fönster'))).toBe(true);
  });

  it('radbrytning mellan orden i en fras spelar ingen roll', () => {
    expect(traff('"Rena Fönster"', text('Rena\nFönster'))).toBe(true);
  });
});

describe('matches: operatorer', () => {
  const a = text('Rikstak köper Takvårdarna');

  it('AND kräver båda', () => {
    expect(traff('Rikstak AND Takvårdarna', a)).toBe(true);
    expect(traff('Rikstak AND Sydkust', a)).toBe(false);
  });

  it('implicit AND', () => {
    expect(traff('Rikstak Takvårdarna', a)).toBe(true);
    expect(traff('Rikstak Sydkust', a)).toBe(false);
  });

  it('OR kräver en av dem', () => {
    expect(traff('Sydkust OR Takvårdarna', a)).toBe(true);
    expect(traff('Sydkust OR Rena', a)).toBe(false);
  });

  it('NOT utesluter', () => {
    expect(traff('Rikstak AND NOT Takvårdarna', a)).toBe(false);
    expect(traff('Rikstak AND NOT Sydkust', a)).toBe(true);
  });

  it('NOT ensamt matchar allt som inte innehåller ordet', () => {
    expect(traff('NOT Sydkust', a)).toBe(true);
    expect(traff('NOT Rikstak', a)).toBe(false);
  });

  it('parenteser och prioritet utvärderas som de tolkas', () => {
    expect(traff('Sydkust AND Rikstak OR Takvårdarna', a)).toBe(true); // (Sydkust AND Rikstak) OR Takvårdarna
    expect(traff('Sydkust AND (Rikstak OR Takvårdarna)', a)).toBe(false);
  });
});

describe('matches: fält', () => {
  const art: Article = {
    title: 'Rikstak köper lokal takfirma',
    body: 'Bolaget förvärvar en takfirma i Kalmar.',
    source: 'di',
    domain: 'di.example.se',
    entity: ['Rikstak', 'Rena Fönster'],
    category: ['forvarv'],
    author: 'Anna Berg',
    region: 'Kalmar län',
    lang: 'sv',
    area: ['takvard'],
  };

  it('utan fält söks både rubrik och brödtext', () => {
    expect(traff('lokal', art)).toBe(true); // bara i rubriken
    expect(traff('Kalmar', art)).toBe(true); // bara i texten
    expect(traff('Sydkust', art)).toBe(false);
  });

  it('title och body söker var för sig', () => {
    expect(traff('title:Rikstak', art)).toBe(true);
    expect(traff('body:Rikstak', art)).toBe(false);
    expect(traff('body:Kalmar', art)).toBe(true);
    expect(traff('title:Kalmar', art)).toBe(false);
  });

  it('source, domain, lang, author, category och area', () => {
    expect(traff('source:di', art)).toBe(true);
    expect(traff('source:barometern', art)).toBe(false);
    expect(traff('domain:di.example.se', art)).toBe(true);
    expect(traff('domain:di*', art)).toBe(true);
    expect(traff('lang:sv', art)).toBe(true);
    expect(traff('lang:en', art)).toBe(false);
    expect(traff('author:Berg', art)).toBe(true);
    expect(traff('category:forvarv', art)).toBe(true);
    expect(traff('area:takvard', art)).toBe(true);
    expect(traff('area:fonsterputs', art)).toBe(false);
  });

  it('region och entity matchar ord i värdet, och entity:fras matchar ett helt namn', () => {
    expect(traff('region:Kalmar', art)).toBe(true);
    expect(traff('entity:"Rena Fönster"', art)).toBe(true);
    expect(traff('entity:Rikstak', art)).toBe(true);
    expect(traff('entity:Sydkust', art)).toBe(false);
  });

  it('en fras går inte över två olika värden i en lista', () => {
    expect(traff('entity:"Rikstak Rena"', art)).toBe(false);
  });

  it('ett fält som saknas på artikeln matchar inget (och NOT matchar det)', () => {
    expect(traff('author:Berg', { title: 'x', body: 'y' })).toBe(false);
    expect(traff('NOT author:Berg', { title: 'x', body: 'y' })).toBe(true);
  });

  it('fält kan kombineras med operatorer', () => {
    expect(traff('source:di AND NOT lang:en', art)).toBe(true);
    expect(traff('(source:facebook OR source:forum) AND Rikstak', art)).toBe(false);
  });
});

describe('matches: NEAR/n', () => {
  const art = text('Rikstak sänker priset på taktvätt med femton procent i hela landet');

  it('träffar när orden är högst n ord ifrån varandra (grannord är avstånd 1)', () => {
    expect(traff('Rikstak NEAR/1 sänker', art)).toBe(true);
    expect(traff('Rikstak NEAR/1 priset', art)).toBe(false);
    expect(traff('Rikstak NEAR/2 priset', art)).toBe(true);
  });

  it('är symmetriskt: ordningen spelar ingen roll', () => {
    expect(traff('priset NEAR/2 Rikstak', art)).toBe(true);
    expect(traff('taktvätt NEAR/4 Rikstak', art)).toBe(true);
    expect(traff('taktvätt NEAR/3 Rikstak', art)).toBe(false);
  });

  it('fungerar med fraser och wildcard', () => {
    expect(traff('"sänker priset" NEAR/2 taktvätt', art)).toBe(true);
    expect(traff('Rikstak NEAR/5 takt*', art)).toBe(true);
    expect(traff('"hela landet" NEAR/2 Rikstak', art)).toBe(false);
  });

  it('samma förekomst räknas inte som nära sig själv', () => {
    expect(traff('Rikstak NEAR/5 Rikstak', art)).toBe(false);
    expect(traff('Rikstak NEAR/5 rikstak', text('Rikstak och Rikstak'))).toBe(true);
  });

  it('gäller inom ett fält, inte mellan rubrik och text', () => {
    const delad: Article = { title: 'Rikstak', body: 'sänker priset' };
    expect(traff('Rikstak NEAR/5 sänker', delad)).toBe(false);
    expect(traff('title:Rikstak NEAR/5 sänker', delad)).toBe(false);
  });

  it('kan kombineras med NOT och AND', () => {
    expect(traff('Rikstak NEAR/2 priset AND NOT pumpa*', art)).toBe(true);
    expect(traff('NOT (Rikstak NEAR/2 priset)', art)).toBe(false);
  });
});
