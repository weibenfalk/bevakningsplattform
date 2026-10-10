/**
 * Frågespråkets tredje steg: utvärderingen matchar ett färdigt träd mot en artikel och svarar ja eller nej.
 *
 * Regler:
 *  - Text delas upp i ord (bokstäver och siffror), och allt jämförs med gemener. Å, ä och ö bevaras:
 *    "Fonster" träffar alltså inte "Fönster".
 *  - Ett ord träffar bara ett helt ord, och ett ord med * träffar alla ord som börjar så (prefix).
 *    Sammansättningar delas inte upp, så taktvätt träffar aldrig "tvätt av tak". Det löses i frågan.
 *  - En term utan fält söks i rubrik och brödtext, var för sig.
 */
import { Field, Node } from './parser';
import { Word, isWordChar } from './tokenizer';

/**
 * Det en fråga kan titta på. Alla fält är valfria, och ett fält som saknas matchar ingenting.
 * Ett fält kan ha flera värden (en artikel kan ha flera entiteter), och varje värde söks för sig.
 */
export type Article = Partial<Record<Field, string | string[]>>;

/** Delar upp text i ord med gemener. */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  const lower = text.normalize('NFC').toLowerCase();
  let start = -1;

  // `i === lower.length` är ett sista varv som avslutar det sista ordet.
  for (let i = 0; i <= lower.length; i++) {
    const inWord = i < lower.length && isWordChar(lower[i]);
    if (inWord && start === -1) start = i;
    if (!inWord && start !== -1) {
      words.push(trimEdges(lower.slice(start, i)));
      start = -1;
    }
  }
  return words.filter((w) => w !== '');
}

/** Punkt, bindestreck och understreck i början eller slutet hör inte till ordet ("Rikstak." är "rikstak"). */
function trimEdges(word: string): string {
  let from = 0;
  let to = word.length;
  while (from < to && !isLetterOrDigit(word[from])) from++;
  while (to > from && !isLetterOrDigit(word[to - 1])) to--;
  return word.slice(from, to);
}

const isLetterOrDigit = (c: string) => c.toLowerCase() !== c.toUpperCase() || (c >= '0' && c <= '9');

/** Ett ord i frågan mot ett ord i texten. */
function wordMatches(queryWord: Word, textWord: string): boolean {
  const wanted = queryWord.text.toLowerCase();
  return queryWord.prefix ? textWord.startsWith(wanted) : textWord === wanted;
}

/** Var i texten (ordnummer, från 0) orden förekommer i följd. En träff är ett spann från första till sista ordet. */
interface Span {
  start: number;
  end: number;
}

function findSpans(textWords: string[], words: Word[]): Span[] {
  const spans: Span[] = [];
  for (let start = 0; start + words.length <= textWords.length; start++) {
    if (words.every((word, offset) => wordMatches(word, textWords[start + offset]))) {
      spans.push({ start, end: start + words.length - 1 });
    }
  }
  return spans;
}

/** Avstånd i ord mellan två spann som inte överlappar. Grannord har avstånd 1. Överlappande spann har inget avstånd. */
function distanceBetween(a: Span, b: Span): number | null {
  if (b.start > a.end) return b.start - a.end;
  if (a.start > b.end) return a.start - b.end;
  return null;
}

/** Värdena i ett fält, som en lista. Rubrik och brödtext är ett värde var. */
function valuesOf(article: Article, field: Field): string[] {
  const value = article[field];
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/** De fält som en term utan fält söks i. */
const DEFAULT_FIELDS: Field[] = ['title', 'body'];

/** Matchar något värde i något av fälten villkoret? Varje värde delas upp i ord för sig. */
function anyValue(article: Article, field: Field | null, test: (textWords: string[]) => boolean): boolean {
  const fields = field ? [field] : DEFAULT_FIELDS;
  return fields.some((f) => valuesOf(article, f).some((value) => test(splitWords(value))));
}

/** Matchar trädet artikeln? */
export function matches(node: Node, article: Article): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => matches(child, article));
    case 'or':
      return node.children.some((child) => matches(child, article));
    case 'not':
      return !matches(node.child, article);
    case 'term':
      return anyValue(article, node.field, (textWords) => findSpans(textWords, node.words).length > 0);
    case 'near':
      return anyValue(article, node.field, (textWords) => {
        const lefts = findSpans(textWords, node.left);
        const rights = findSpans(textWords, node.right);
        return lefts.some((l) =>
          rights.some((r) => {
            const distance = distanceBetween(l, r);
            return distance !== null && distance <= node.distance;
          }),
        );
      });
  }
}

/** En term som text, så som den kan läsas i frågan: `title:"Rena Fönster"`, `pumpa*` eller `a NEAR/3 b`. */
export function termText(node: Extract<Node, { type: 'term' | 'near' }>): string {
  const words = (list: Word[]) => {
    const text = list.map((w) => w.text + (w.prefix ? '*' : '')).join(' ');
    return list.length > 1 ? `"${text}"` : text;
  };
  const field = node.field ? `${node.field}:` : '';
  if (node.type === 'term') return field + words(node.words);
  return `${field}${words(node.left)} NEAR/${node.distance} ${words(node.right)}`;
}

/**
 * Vilka termer i frågan som gav träffen. Tom lista om artikeln inte träffar. Termer under NOT räknas inte,
 * eftersom de är villkor som ska saknas.
 */
export function explain(node: Node, article: Article): string[] {
  if (!matches(node, article)) return [];
  switch (node.type) {
    case 'and':
    case 'or':
      return node.children.flatMap((child) => explain(child, article));
    case 'not':
      return [];
    default:
      return [termText(node)];
  }
}

const group = (node: Node): string => (node.type === 'and' || node.type === 'or' ? `(${nodeText(node)})` : nodeText(node));

/** Ett helt träd som läsbar fråga, till exempel `(rotavdrag* OR Arbetsmiljöverket) AND NOT Rättelse`. */
export function nodeText(node: Node): string {
  switch (node.type) {
    case 'term':
    case 'near':
      return termText(node);
    case 'not':
      return `NOT ${group(node.child)}`;
    case 'and':
      return node.children.map(group).join(' AND ');
    case 'or':
      return node.children.map(group).join(' OR ');
  }
}

/** Alla NOT-noder i trädet, även nästlade (en nod före sina barn). */
export function notNodes(node: Node): Extract<Node, { type: 'not' }>[] {
  switch (node.type) {
    case 'not':
      return [node, ...notNodes(node.child)];
    case 'and':
    case 'or':
      return node.children.flatMap(notNodes);
    default:
      return [];
  }
}

/** Trädet där just den här NOT-noden är borttagen (ersatt av ett villkor som alltid gäller). Originalet ändras inte. */
export function relaxNot(node: Node, target: Node): Node {
  if (node === target) return { type: 'and', children: [] };
  switch (node.type) {
    case 'not':
      return { type: 'not', child: relaxNot(node.child, target) };
    case 'and':
    case 'or':
      return { type: node.type, children: node.children.map((c) => relaxNot(c, target)) };
    default:
      return node;
  }
}
