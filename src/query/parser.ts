/**
 * Frågespråkets andra steg: parsern bygger ett träd av tokens. Den följer grammatiken i specens avsnitt 6,
 * med en funktion per grammatikregel (rekursiv medåkning):
 *
 *   uttryck    := orUttryck
 *   orUttryck  := ochUttryck ( "OR" ochUttryck )*
 *   ochUttryck := nekat ( ("AND" | implicit) nekat )*
 *   nekat      := [ "NOT" ] atom
 *   atom       := "(" uttryck ")" | term
 *   term       := [ fält ":" ] ( fras | ord | närhet )
 *   närhet     := ( ord | fras ) "NEAR/" siffra ( ord | fras )
 *
 * Reglerna för fras och ord hanteras redan av tokenizern.
 */
import { QuerySyntaxError, Token, Word, tokenize } from './tokenizer';

export type { Word };

export const FIELDS = ['title', 'body', 'source', 'domain', 'entity', 'category', 'author', 'region', 'lang', 'area'] as const;
export type Field = (typeof FIELDS)[number];

/**
 * Träd för en fråga. Ett ord är en term med ett ord, och en fras är en term med flera ord.
 * `field` är null när termen ska sökas i både rubrik och brödtext.
 */
export type Node =
  | { type: 'and'; children: Node[] }
  | { type: 'or'; children: Node[] }
  | { type: 'not'; child: Node }
  | { type: 'term'; field: Field | null; words: Word[] }
  | { type: 'near'; field: Field | null; left: Word[]; right: Word[]; distance: number };

/** Beskriver en token i ett felmeddelande. */
function describe(token: Token): string {
  switch (token.type) {
    case 'END':
      return 'slutet av frågan';
    case 'WORD':
      return `ordet '${token.text}${token.prefix ? '*' : ''}'`;
    case 'PHRASE':
      return `frasen "${token.words.map((w) => w.text + (w.prefix ? '*' : '')).join(' ')}"`;
    case 'NEAR':
      return `NEAR/${token.distance}`;
    case 'LPAREN':
      return "'('";
    case 'RPAREN':
      return "')'";
    case 'COLON':
      return "':'";
    default:
      return token.type; // AND, OR, NOT
  }
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  // ---- Hjälpmetoder ----

  /** Nästa token, utan att gå förbi den. `ahead` tittar längre fram. */
  private peek(ahead = 0): Token {
    // Listan slutar alltid med END, och vi går aldrig förbi den.
    return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)];
  }

  /** Nästa token, och gå vidare. */
  private next(): Token {
    const token = this.peek();
    if (token.type !== 'END') this.index++;
    return token;
  }

  // ---- Grammatikreglerna ----

  /** Hela frågan: ett uttryck, och därefter får inget mer finnas. */
  parseQuery(): Node {
    if (this.peek().type === 'END') throw new QuerySyntaxError('Frågan är tom', this.peek().pos);

    const node = this.parseOr();
    const rest = this.peek();
    if (rest.type === 'RPAREN') {
      throw new QuerySyntaxError("Parentesen ')' saknar en matchande '('", rest.pos);
    }
    if (rest.type !== 'END') throw new QuerySyntaxError(`Oväntat ${describe(rest)}`, rest.pos);
    return node;
  }

  /** orUttryck := ochUttryck ( "OR" ochUttryck )* */
  private parseOr(): Node {
    const children = [this.parseAnd()];
    while (this.peek().type === 'OR') {
      this.next();
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  /** ochUttryck := nekat ( ("AND" | implicit) nekat )* */
  private parseAnd(): Node {
    const children = [this.parseNot()];
    for (;;) {
      const token = this.peek();
      if (token.type === 'AND') {
        this.next();
        children.push(this.parseNot());
      } else if (token.type === 'NOT' || token.type === 'LPAREN' || token.type === 'WORD' || token.type === 'PHRASE') {
        // Implicit AND: en ny operand utan operator emellan.
        children.push(this.parseNot());
      } else {
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  /** nekat := [ "NOT" ] atom */
  private parseNot(): Node {
    if (this.peek().type === 'NOT') {
      this.next();
      return { type: 'not', child: this.parseAtom() };
    }
    return this.parseAtom();
  }

  /** atom := "(" uttryck ")" | term */
  private parseAtom(): Node {
    if (this.peek().type !== 'LPAREN') return this.parseTerm();

    const open = this.next();
    const inner = this.parseOr();
    const close = this.peek();
    if (close.type === 'RPAREN') {
      this.next();
      return inner;
    }
    if (close.type === 'END') throw new QuerySyntaxError("Parentesen '(' stängs aldrig", open.pos);
    throw new QuerySyntaxError(`Oväntat ${describe(close)}`, close.pos);
  }

  /** term := [ fält ":" ] ( fras | ord | närhet ) */
  private parseTerm(): Node {
    let field: Field | null = null;
    const first = this.peek();

    if (first.type === 'WORD' && this.peek(1).type === 'COLON') {
      const name = first.text.toLowerCase();
      const known = FIELDS.find((f) => f === name);
      if (first.prefix || !known) {
        throw new QuerySyntaxError(`Okänt fält '${first.text}'. Tillåtna fält: ${FIELDS.join(', ')}`, first.pos);
      }
      field = known;
      this.next(); // fältnamnet
      this.next(); // kolonet
    }

    const left = this.parseOperand(field);
    if (this.peek().type !== 'NEAR') return { type: 'term', field, words: left };

    const near = this.next();
    const right = this.parseOperand(field);
    return { type: 'near', field, left, right, distance: (near as Extract<Token, { type: 'NEAR' }>).distance };
  }

  /** Ett ord eller en fras, som en lista med ord. */
  private parseOperand(field: Field | null): Word[] {
    const token = this.peek();
    if (token.type === 'WORD') {
      this.next();
      return [{ text: token.text, prefix: token.prefix }];
    }
    if (token.type === 'PHRASE') {
      this.next();
      return token.words;
    }
    const expected = field ? `ett ord eller en fras efter ${field}:` : "ett ord, en fras eller '('";
    throw new QuerySyntaxError(`Väntade ${expected} men hittade ${describe(token)}`, token.pos);
  }
}

/** Tolkar en fråga till ett träd. Kastar `QuerySyntaxError` med position om frågan är felaktig. */
export function parse(query: string): Node {
  return new Parser(tokenize(query)).parseQuery();
}
