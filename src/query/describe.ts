/** Gör tokens, träd och fel läsbara som text. Används av `npm run query` och testas separat. */
import { termText } from './evaluator';
import { Node } from './parser';
import { QuerySyntaxError, Token } from './tokenizer';

/** En token per rad: position och typ, och ordet eller frasen om det finns ett. */
export function tokenLines(tokens: Token[]): string[] {
  return tokens.map((t) => {
    let detail = '';
    if (t.type === 'WORD') detail = ` ${t.text}${t.prefix ? '*' : ''}`;
    if (t.type === 'PHRASE') detail = ` "${t.words.map((w) => w.text + (w.prefix ? '*' : '')).join(' ')}"`;
    if (t.type === 'NEAR') return `${String(t.pos).padEnd(4)}NEAR/${t.distance}`;
    return `${String(t.pos).padEnd(4)}${t.type}${detail}`;
  });
}

/** Trädet med två blanksteg indrag per nivå. */
export function treeLines(node: Node, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  switch (node.type) {
    case 'and':
      return [`${indent}AND`, ...node.children.flatMap((c) => treeLines(c, depth + 1))];
    case 'or':
      return [`${indent}OR`, ...node.children.flatMap((c) => treeLines(c, depth + 1))];
    case 'not':
      return [`${indent}NOT`, ...treeLines(node.child, depth + 1)];
    default:
      return [`${indent}TERM ${termText(node)}`];
  }
}

/** Frågan, en ^ under felets position och felmeddelandet. */
export function errorMarker(query: string, error: QuerySyntaxError): string[] {
  // Tokenizern räknar positioner i den normaliserade texten, så den visas här.
  return [query.normalize('NFC'), `${' '.repeat(error.position - 1)}^`, error.message];
}
