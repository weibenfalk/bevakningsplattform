/**
 * Frågespråkets första steg: tokenizern delar upp frågetexten i tokens (ord, fraser, operatorer, parenteser).
 * Den går igenom texten tecken för tecken. Krav 4 i specen: inga reguljära uttryck, inte ens här.
 *
 * Positioner räknas från 1, så att felmeddelandet kan visa var i frågan det gick fel.
 */

/** Syntaxfel i en fråga. `position` är tecknets plats i frågan (första tecknet är position 1). */
export class QuerySyntaxError extends Error {
  constructor(
    readonly description: string,
    readonly position: number,
  ) {
    super(`${description} (position ${position})`);
    this.name = 'QuerySyntaxError';
  }
}

/** Ett sökord. `prefix` betyder att ordet slutar med * (pumpa* träffar pumpa, pumpatävling ...). */
export interface Word {
  text: string;
  prefix: boolean;
}

export type Token =
  | { type: 'WORD'; text: string; prefix: boolean; pos: number }
  | { type: 'PHRASE'; words: Word[]; pos: number }
  | { type: 'NEAR'; distance: number; pos: number }
  | { type: 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN' | 'COLON' | 'END'; pos: number };

const WILDCARD_FEL = 'Wildcard (*) får bara stå sist i ett ord, till exempel pumpa*, inte först eller mitt i';

// ---- Teckenklasser (utan reguljära uttryck) ----

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDigit = (c: string) => c >= '0' && c <= '9';
/**
 * En bokstav är ett tecken som har olika versal och gemen. Det gäller a-z och å, ä, ö (och andra alfabet med
 * versaler), men inte siffror eller skiljetecken.
 */
const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();
/** Ett ord börjar med bokstav eller siffra. */
const isWordStart = (c: string) => isLetter(c) || isDigit(c);
/** Inne i ett ord får det också finnas bindestreck, understreck och punkt (e-post, google_reviews, poit.example.se). */
export const isWordChar = (c: string) => isWordStart(c) || c === '-' || c === '_' || c === '.';

// ---- Delar av tokenizern ----

/**
 * Läser ett ord från `start`. Ett * är bara tillåtet direkt efter ordet och bara som sista tecken
 * (svenska regler: wildcard är bara prefix).
 */
function readWord(query: string, start: number): { text: string; prefix: boolean; end: number } {
  if (query[start] === '*') throw new QuerySyntaxError(WILDCARD_FEL, start + 1);

  let end = start;
  while (end < query.length && isWordChar(query[end])) end++;
  const text = query.slice(start, end);

  if (query[end] !== '*') return { text, prefix: false, end };

  // Stjärnan måste vara sist: efter den får inget mer ordtecken eller någon ny stjärna komma.
  const next = query[end + 1];
  if (next !== undefined && (isWordChar(next) || next === '*')) throw new QuerySyntaxError(WILDCARD_FEL, end + 1);
  return { text, prefix: true, end: end + 1 };
}

/** Läser en fras. `start` är positionen för det inledande citattecknet. */
function readPhrase(query: string, start: number): { words: Word[]; end: number } {
  const words: Word[] = [];
  let i = start + 1;

  while (i < query.length && query[i] !== '"') {
    const c = query[i];
    if (isSpace(c)) {
      i++;
    } else if (isWordStart(c) || c === '*') {
      const word = readWord(query, i);
      words.push({ text: word.text, prefix: word.prefix });
      i = word.end;
    } else {
      throw new QuerySyntaxError(`Tecknet '${c}' är inte tillåtet i en fras`, i + 1);
    }
  }

  if (i >= query.length) throw new QuerySyntaxError('Citattecknet stängs aldrig', start + 1);
  if (words.length === 0) throw new QuerySyntaxError('En fras får inte vara tom', start + 1);
  return { words, end: i + 1 };
}

/** Läser siffrorna efter `NEAR/`. `start` är positionen för ordet NEAR, och `i` är positionen efter snedstrecket. */
function readDistance(query: string, start: number, i: number): { distance: number; end: number } {
  let end = i;
  while (end < query.length && isDigit(query[end])) end++;

  const digits = query.slice(i, end);
  const next = query[end];
  if (digits === '' || (next !== undefined && (isWordChar(next) || next === '*'))) {
    throw new QuerySyntaxError('NEAR/ måste följas av en siffra, till exempel NEAR/3', start + 1);
  }
  const distance = Number(digits);
  if (distance < 1) throw new QuerySyntaxError('Avståndet i NEAR/n måste vara minst 1', start + 1);
  return { distance, end };
}

/** Delar upp en fråga i tokens. Listan slutar alltid med en END-token. */
export function tokenize(rawQuery: string): Token[] {
  // Å, ä och ö kan skrivas som ett tecken eller som bokstav + prickar. Vi gör alltid det första.
  const query = rawQuery.normalize('NFC');
  const tokens: Token[] = [];
  let i = 0;

  while (i < query.length) {
    const c = query[i];
    const pos = i + 1;

    if (isSpace(c)) {
      i++;
    } else if (c === '(') {
      tokens.push({ type: 'LPAREN', pos });
      i++;
    } else if (c === ')') {
      tokens.push({ type: 'RPAREN', pos });
      i++;
    } else if (c === ':') {
      tokens.push({ type: 'COLON', pos });
      i++;
    } else if (c === '"') {
      const phrase = readPhrase(query, i);
      tokens.push({ type: 'PHRASE', words: phrase.words, pos });
      i = phrase.end;
    } else if (isWordStart(c) || c === '*') {
      const word = readWord(query, i);
      if (!word.prefix && (word.text === 'AND' || word.text === 'OR' || word.text === 'NOT')) {
        // Operatorer skrivs med versaler. "and", "or" och "not" är vanliga ord.
        tokens.push({ type: word.text, pos });
        i = word.end;
      } else if (!word.prefix && word.text === 'NEAR' && query[word.end] === '/') {
        const near = readDistance(query, i, word.end + 1);
        tokens.push({ type: 'NEAR', distance: near.distance, pos });
        i = near.end;
      } else {
        tokens.push({ type: 'WORD', text: word.text, prefix: word.prefix, pos });
        i = word.end;
      }
    } else {
      throw new QuerySyntaxError(`Tecknet '${c}' är inte tillåtet i en fråga`, pos);
    }
  }

  tokens.push({ type: 'END', pos: query.length + 1 });
  return tokens;
}
