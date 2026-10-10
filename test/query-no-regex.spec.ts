import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import * as ts from 'typescript';

/**
 * Krav 4: frågespråket byggs utan reguljära uttryck. Testet läser koden med TypeScript-kompilatorn
 * (inte med en textsökning) och letar efter regex-litteraler, `RegExp` och strängmetoder som tar emot regex.
 */
const REGEX_METODER = ['match', 'matchAll', 'replace', 'replaceAll', 'search', 'split', 'test', 'exec'];

function regexAnvandning(fil: string): string[] {
  const kalla = ts.createSourceFile(fil, readFileSync(fil, 'utf8'), ts.ScriptTarget.ES2022, true);
  const fynd: string[] = [];
  const besok = (node: ts.Node) => {
    const rad = kalla.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (ts.isRegularExpressionLiteral(node)) fynd.push(`${fil}:${rad} regex-litteral ${node.getText()}`);
    if (ts.isIdentifier(node) && node.text === 'RegExp') fynd.push(`${fil}:${rad} RegExp`);
    // Strängmetoder som kan ta ett regex (match, replace ...) får inte användas alls i frågespråket.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const namn = node.expression.name.text;
      if (REGEX_METODER.includes(namn) && namn !== 'split') fynd.push(`${fil}:${rad} .${namn}()`);
      if (namn === 'split' && node.arguments.some((a) => !ts.isStringLiteral(a))) fynd.push(`${fil}:${rad} .split() med annat än sträng`);
    }
    ts.forEachChild(node, besok);
  };
  besok(kalla);
  return fynd;
}

describe('frågespråket använder inga reguljära uttryck (krav 4)', () => {
  const filer = globSync('src/query/**/*.ts');

  it('det finns kod att granska: tokenizer, parser och utvärdering', () => {
    expect(filer.map((f) => f.split('/').pop()).sort()).toEqual(['evaluator.ts', 'parser.ts', 'tokenizer.ts']);
  });

  it('ingen fil i src/query använder regex', () => {
    expect(filer.flatMap(regexAnvandning)).toEqual([]);
  });

  it('kontrollen fungerar: den hittar regex i ett exempel', () => {
    const skriv = (kod: string) => {
      const fil = 'regex-exempel.ts';
      const kalla = ts.createSourceFile(fil, kod, ts.ScriptTarget.ES2022, true);
      return ts.isRegularExpressionLiteral((kalla.statements[0] as ts.ExpressionStatement).expression);
    };
    expect(skriv('/a+/;')).toBe(true);
  });
});
