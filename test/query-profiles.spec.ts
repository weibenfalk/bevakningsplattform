import { readFileSync } from 'node:fs';
import { Article, matches } from '../src/query/evaluator';
import { parse } from '../src/query/parser';
import { QuerySyntaxError } from '../src/query/tokenizer';

interface Profile { id: string; user: string; query: string }
interface Raw { id: string; source: string; url: string; title: string; text: string }

const lasa = <T>(fil: string): T => JSON.parse(readFileSync(`data/${fil}`, 'utf8')) as T;
const profiles = lasa<Profile[]>('profiles.json');
const raw = [...lasa<Raw[]>('raw_items.json'), ...lasa<Raw[]>('raw_items_dag2.json'), ...lasa<Raw[]>('raw_items_extra.json')];

/** En råpost som sökbar artikel. Domänen är värdnamnet i URL:en. */
const artikel = (r: Raw): Article => ({ title: r.title, body: r.text, source: r.source, domain: new URL(r.url).hostname });

const query = (id: string) => profiles.find((p) => p.id === id)!.query;
/** Id:n på de råposter som profilen träffar (unika, i filens ordning). */
const traffar = (id: string): string[] => {
  const tree = parse(query(id));
  return [...new Set(raw.filter((r) => matches(tree, artikel(r))).map((r) => r.id))];
};

describe('profilerna i data/profiles.json', () => {
  it('pf-tak-pris (oparad parentes) ger ett fel som pekar på parentesen, och kraschar inte', () => {
    try {
      parse(query('pf-tak-pris'));
      throw new Error('borde ha kastat');
    } catch (e) {
      expect(e).toBeInstanceOf(QuerySyntaxError);
      expect((e as QuerySyntaxError).position).toBe(1);
      expect((e as QuerySyntaxError).message).toBe("Parentesen '(' stängs aldrig (position 1)");
    }
  });

  it('pf-puts (inledande *) ger ett fel som pekar på stjärnan, och kraschar inte', () => {
    try {
      parse(query('pf-puts'));
      throw new Error('borde ha kastat');
    } catch (e) {
      expect(e).toBeInstanceOf(QuerySyntaxError);
      expect((e as QuerySyntaxError).position).toBe(1);
      expect((e as QuerySyntaxError).message).toMatch(/Wildcard \(\*\) får bara stå sist i ett ord/);
    }
  });

  it('en trasig profil matchar ingen artikel tyst: parse kastar, så ingen matchning kan köras', () => {
    for (const id of ['pf-tak-pris', 'pf-puts']) {
      expect(() => traffar(id)).toThrow(QuerySyntaxError);
    }
  });

  it('pf-konkurrenter-tak träffar Rikstak och Takvårdarna i dag 1', () => {
    // r19 (injektionstexten "Rikstak i konkurs?!") träffar också: frågan matchar ord, och skyddet mot
    // instruktioner i texten ligger i berikningen, inte här.
    const dag1 = traffar('pf-konkurrenter-tak').filter((id) => id.startsWith('r'));
    expect(dag1).toEqual(['r01', 'r02', 'r03', 'r04', 'r05', 'r13', 'r19']);
  });

  it('NOT pumpa* gör skillnad: samma fråga utan NOT hade släppt in en pumpartikel om den nämnde Rikstak', () => {
    const tree = parse(query('pf-konkurrenter-tak'));
    const pumpa: Article = { title: 'Rikstak sponsrar', body: 'Rikstak sponsrar årets pumpatävling' };
    expect(matches(tree, pumpa)).toBe(false);
    expect(matches(parse('Rikstak OR Takvårdarna'), pumpa)).toBe(true);
  });

  it('pf-regler träffar rotavdraget och fallskyddsreglerna', () => {
    expect(traffar('pf-regler').filter((id) => id.startsWith('r'))).toEqual(['r06', 'r16', 'r17']);
  });

  it('pf-koncern träffar börsnoteringen (r11)', () => {
    expect(traffar('pf-koncern').filter((id) => id.startsWith('r'))).toEqual(['r11']);
  });

  it('pf-rena träffar Rena Fönster och Rena Fonster samt fönsterput*', () => {
    // r06 nämner "fönsterputs", r07 "Fönsterputsare". r08 (städtips: "Rena fönster") träffar också,
    // eftersom frågor inte skiljer på versaler och gemener. Det avgörs i frågan, inte i koden.
    expect(traffar('pf-rena').filter((id) => id.startsWith('r'))).toEqual(['r06', 'r07', 'r08', 'r09', 'r14']);
  });

  it('pf-tak-pris med parentesen rättad parsas och träffar Rikstak med takmålning eller taktvätt', () => {
    const rattad = '(Rikstak AND (takmålning OR taktvätt))';
    const tree = parse(rattad);
    const ids = raw.filter((r) => matches(tree, artikel(r))).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['r05', 'r13']));
    expect(ids).not.toContain('r04');
  });
});
