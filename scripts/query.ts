/**
 * Visar vad frågespråket gör med en fråga: tokens, träd och vilka artiklar i testdatan (dag 1 och dag 2) som träffar.
 * Ingen databas behövs, datan läses direkt från data/.
 *
 *   npm run query -- '(Rikstak OR Takvårdarna) AND NOT pumpa*'
 */
import { readFileSync } from 'node:fs';
import { errorMarker, tokenLines, treeLines } from '../src/query/describe';
import { Article, explain } from '../src/query/evaluator';
import { parse } from '../src/query/parser';
import { QuerySyntaxError, tokenize } from '../src/query/tokenizer';
import { RawItem } from '../src/types';
import { loadQueryItems } from './query-data';

const query = process.argv.slice(2).join(' ');
if (query.trim() === '') {
  console.error('Användning: npm run query -- "<fråga>"');
  process.exit(2);
}

const poster = loadQueryItems();
/** En råpost som sökbar artikel. Domänen är värdnamnet i URL:en. */
const artikel = (r: RawItem): Article => ({ title: r.title, body: r.text, source: r.source, domain: new URL(r.url).hostname });

try {
  // Allt räknas ut innan något skrivs, så att ett syntaxfel inte lämnar en halv utskrift.
  const tokens = tokenize(query);
  const tree = parse(query);
  const traffar = poster.map(({ day: dag, item: r }) => ({ dag, r, termer: explain(tree, artikel(r)) })).filter((t) => t.termer.length > 0);

  console.log('Tokens:');
  tokenLines(tokens).forEach((l) => console.log(`  ${l}`));
  console.log('\nTräd:');
  treeLines(tree).forEach((l) => console.log(`  ${l}`));

  console.log(`\nTräffar (${traffar.length} av ${poster.length} artiklar, dag 1 och dag 2):`);
  for (const { dag, r, termer } of traffar) {
    console.log(`  ${r.id} (dag ${dag})  ${r.title || '(ingen rubrik)'}`);
    console.log(`      term: ${termer.join(', ')}`);
  }
} catch (e) {
  if (!(e instanceof QuerySyntaxError)) throw e;
  console.error('Syntaxfel:');
  errorMarker(query, e).forEach((l) => console.error(`  ${l}`));
  process.exit(1);
}
