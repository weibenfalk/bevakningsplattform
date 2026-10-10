import * as ts from 'typescript';

/**
 * Detektorn bakom arkitekturtestet (krav 1): hittar alla sätt att nå innehållstabellerna i en källfil.
 * Den läser koden med TypeScript-kompilatorn (inte med en textsökning) och tittar på:
 *
 *  1. Varje strängliteral, och varje del av en mallsträng, som innehåller en innehållstabell som ord. Det fångar
 *     `knex('articles')`, `.from('articles as a')`, `.join('profile_matches as m', ...)`, `.table(...)` och rå SQL
 *     (`knex.raw('select * from public.articles')`) utan att behöva känna till varje metod.
 *  2. Anrop av en knex-instans (`knex(...)`, `this.knex(...)`, `trx(...)`) vars tabellnamn inte är en bokstavlig
 *     sträng, och rå SQL som byggs dynamiskt. Då går det inte att se vilken tabell som läses, och det räknas som brott.
 *
 * Kommentarer och argument till dekoratorer (route-sökvägar) räknas inte, eftersom de inte är kod. Namn som `article_id` räknas inte, eftersom ordet måste vara hela
 * tabellnamnet.
 */

/**
 * Tabeller med innehåll, eller som visar vilket innehåll som finns. Läsning ska gå via åtkomstmodulen (src/access),
 * som lägger på användarens omfång. `skipped_items` innehåller hela råposter (alltså råtext).
 * `entity_matches`, `profile_matches` och `delivery_items` pekar ut artiklar, och utgåvor, utskick och omdömen innehåller eller
 * pekar på dem. Register och inställningar (entities, profiles, users, ...) är inte innehåll.
 */
export const CONTENT_TABLES = ['articles', 'profile_matches', 'entity_matches', 'skipped_items', 'editions', 'deliveries', 'feedback', 'delivery_items'];

/** Namn som en knex-instans eller transaktion har i koden. */
const KNEX_NAMES = ['knex', 'trx', 'tx', 'db'];

/** Metoder som skriver. En kedja som bara består av dessa (och villkor) är skrivning och inte läsning. */
const WRITE_METHODS = ['insert', 'update', 'delete', 'del'];
const WRITE_CHAIN_METHODS = [...WRITE_METHODS, 'where', 'whereIn', 'onConflict', 'ignore', 'merge', 'returning'];

/**
 * Metoder som tar emot ett tabellnamn och som inte får få ett dynamiskt. Anrop på en global klass med stor
 * begynnelsebokstav (`Array.from`, `Uint8Array.from`) är inte knex.
 */
const TABLE_METHODS = ['table', 'into', 'from'];

export interface Exception {
  file: string;
  table: string;
  /** Varför just den här skrivningen får ligga utanför åtkomstmodulen. */
  why: string;
}

export interface Finding {
  file: string;
  line: number;
  message: string;
}

export interface ScanResult {
  findings: Finding[];
  /** De undantag som faktiskt användes, så att ett undantag som inte behövs längre kan upptäckas. */
  usedExceptions: Exception[];
}

const isWordChar = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';

/** Orden i en text. `articles as a` ger [articles, as, a], och `article_id` ger [article_id]. */
function words(text: string): string[] {
  const result: string[] = [];
  let current = '';
  for (const c of `${text} `) {
    if (isWordChar(c)) current += c;
    else if (current) {
      result.push(current);
      current = '';
    }
  }
  return result;
}

function stringText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return null;
}

const isLiteralString = (node: ts.Node | undefined) => !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

function isKnexCallee(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return KNEX_NAMES.includes(expr.text);
  return ts.isPropertyAccessExpression(expr) && KNEX_NAMES.includes(expr.name.text);
}

/** Är det här tabellnamnet i ett anrop som bara skriver, till exempel `trx('profile_matches').where(...).delete()`? */
function isWriteUse(literal: ts.Node): boolean {
  const call = literal.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== literal || !isKnexCallee(call.expression)) return false;

  const methods: string[] = [];
  let current: ts.Node = call;
  for (;;) {
    const access = current.parent;
    const next = access?.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== current || !ts.isCallExpression(next) || next.expression !== access) break;
    // `returning('id')` ger tillbaka id:t på det som skrevs. Allt annat (till exempel '*') är läsning.
    if (access.name.text === 'returning' && !(next.arguments.length === 1 && ts.isStringLiteral(next.arguments[0]) && next.arguments[0].text === 'id')) {
      return false;
    }
    methods.push(access.name.text);
    current = next;
  }
  return methods.some((m) => WRITE_METHODS.includes(m)) && methods.every((m) => WRITE_CHAIN_METHODS.includes(m));
}

export function scanSource(file: string, source: string, exceptions: Exception[]): ScanResult {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const findings: Finding[] = [];
  const used = new Set<Exception>();
  const report = (node: ts.Node, message: string) =>
    findings.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, message });

  const visit = (node: ts.Node) => {
    // Argument till dekoratorer är metadata (till exempel route-sökvägen @Get('articles.csv')), inte frågor.
    if (ts.isDecorator(node)) return;
    const text = stringText(node);
    if (text !== null) {
      for (const table of new Set(words(text).filter((w) => CONTENT_TABLES.includes(w)))) {
        const exception = isWriteUse(node) ? exceptions.find((e) => e.file === file && e.table === table) : undefined;
        if (exception) used.add(exception);
        else report(node, `rör innehållstabellen ${table} utanför src/access`);
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      // knex({ client: ... }) skapar anslutningen och har inget tabellnamn.
      if (isKnexCallee(callee) && !isLiteralString(first) && !(first && ts.isObjectLiteralExpression(first))) {
        report(node, 'anropar knex med ett tabellnamn som inte är en bokstavlig sträng, så det går inte att se vilken tabell det gäller');
      }
      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        const receiver = ts.isIdentifier(callee.expression) ? callee.expression.text : '';
        const isGlobalClass = receiver !== '' && receiver[0] === receiver[0].toUpperCase() && receiver[0] !== receiver[0].toLowerCase();
        if (TABLE_METHODS.includes(name) && !isGlobalClass && first && !isLiteralString(first)) {
          report(node, `.${name}() med ett tabellnamn som inte är en bokstavlig sträng`);
        }
        if (name.toLowerCase().endsWith('raw') && first && !isLiteralString(first)) {
          report(node, `.${name}() med SQL som byggs dynamiskt, så det går inte att se vilka tabeller det gäller`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { findings, usedExceptions: [...used] };
}
