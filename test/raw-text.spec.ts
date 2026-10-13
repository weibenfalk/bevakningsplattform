import { readFileSync } from 'node:fs';
import { INestApplicationContext } from '@nestjs/common';
import { globSync } from 'glob';
import * as ts from 'typescript';
import { ExportController } from '../src/export/export.controller';
import { DigestService } from '../src/digest/digest.service';
import { renderDigest } from '../src/digest/render';
import { closeTestingApp, createTestingApp, seedArticles } from './helpers';

const RAW = 'RÅTEXT-SKA-ALDRIG-LÄMNA-SYSTEMET';

describe('råtext lämnar aldrig systemet', () => {
  let app: INestApplicationContext;
  beforeEach(async () => {
    app = await createTestingApp();
    await seedArticles([
      { raw_id: 'a1', spaces: ['fonsterputs'], urgency: 'info', relevance: 90, summary: 'Kort sammanfattning', full_text: RAW },
    ]);
  });
  afterEach(closeTestingApp);

  it('mejlet innehåller inte fulltexten', async () => {
    const html = await app.get(DigestService).compose('u-anna');
    expect(html).toContain('Kort sammanfattning');
    expect(html).not.toContain(RAW);
  });

  it('exporten innehåller inte fulltexten, ens när hela raden efterfrågas via sort eller användare', async () => {
    let body = '';
    const res = { type: () => res, send: (b: string) => { body = b; } };
    await app.get(ExportController).articles({ user: { id: 'u-anna' } } as never, res as never, undefined, 'relevance desc');
    expect(body).toContain('Artikel a1');
    expect(body).not.toContain(RAW);
  });
});

describe('mejlrendering utan sammanfattning', () => {
  it('klarar en artikel utan sammanfattning (null) och skriver inte "null"', () => {
    const html = renderDigest([{ title: 'T', url: 'https://example.se', urgency: 'info', otherSources: [], summary: null }]);
    expect(html).toContain('T');
    expect(html).not.toContain('null');
  });
});

/**
 * Uttalat undantag: åtkomstmodulen får läsa originaltexten på ett enda ställe, `matchWholeArchive`, för frågetestaren.
 * Motivering ur specen: originaltexten får inte visas eller skickas ut (utskick, visning, export), men får användas
 * för bearbetning i 90 dagar. Frågetestaren provar en profilfråga, alltså samma bearbetning som profilmatchningen,
 * och skiljer sig bara genom att den körs mot arkivet. Texten lämnar aldrig metoden: anroparen får artikelraden
 * (utan text) och de termer som träffade.
 */
const FULLTEXT_READERS = [
  { file: 'src/access/article-access.service.ts', method: 'matchWholeArchive' },
];

/** Var i koden strängen 'full_text' används, som namnet på den metod (eller konstant) den står i. */
function fulltextUses(file: string, code: string): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const uses: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /full_text|fullText/.test(node.text)) {
      // Den yttersta metoden, funktionen eller konstanten som strängen står i (inte en lokal variabel inuti den).
      let owner: ts.Node | undefined;
      for (let n: ts.Node | undefined = node; n; n = n.parent) {
        const declares = ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n) || (ts.isVariableDeclaration(n) && ts.isVariableStatement(n.parent.parent));
        if (declares) owner = n;
      }
      uses.push(owner && 'name' in owner && owner.name ? (owner.name as ts.Identifier).text : '(utanför metod)');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

describe('arkitekturregel: råtext', () => {
  it('bara berikningen skriver full_text och rensningen nollar den. Åtkomstmodulen har ett uttalat undantag', () => {
    const allowed = ['src/pipeline/enrich.service.ts', 'src/pipeline/purge.service.ts', ...FULLTEXT_READERS.map((r) => r.file)];
    const offenders = globSync('src/**/*.ts', { ignore: allowed })
      .filter((file) => /full_text|fullText/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('i åtkomstmodulen läses originaltexten bara i matchWholeArchive, aldrig i kolumnlistan eller någon annan metod', () => {
    for (const { file, method } of FULLTEXT_READERS) {
      const uses = fulltextUses(file, readFileSync(file, 'utf8'));
      expect(uses.length).toBeGreaterThan(0); // undantaget används fortfarande
      expect(new Set(uses)).toEqual(new Set([method]));
    }
  });

  it('detektorn fäller originaltexten i en annan metod och i kolumnlistan', () => {
    expect(fulltextUses('x.ts', "class A { forUser() { return q.select('full_text'); } }")).toEqual(['forUser']);
    expect(fulltextUses('x.ts', "const PUBLIC_COLUMNS = ['id', 'full_text'];")).toEqual(['PUBLIC_COLUMNS']);
    expect(fulltextUses('x.ts', "class A { matchWholeArchive() { q.select('full_text'); } }")).toEqual(['matchWholeArchive']);
  });
});
