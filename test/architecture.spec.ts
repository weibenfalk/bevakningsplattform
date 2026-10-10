import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { CONTENT_TABLES, Exception, scanSource } from './architecture-scan';

/**
 * Krav 1 i specen: all läsning av innehåll går genom åtkomstmodulen (src/access), som lägger på användarens
 * omfång. Testet fäller bygget om annan kod i src läser innehållstabellerna. Det läser koden med
 * TypeScript-kompilatorn och hittar `knex('articles')`, `.from(...)`, `.join(...)`, rå SQL och tabellnamn som byggs
 * dynamiskt (se architecture-scan.ts).
 *
 * Undantag finns bara för SKRIVNING i pipelinen, och bara om anropet är en ren skrivning (insert, update eller
 * delete med villkor). `select`, `first`, `count`, `join` och allt annat är läsning, och den får inte ligga här.
 *
 * Avgränsning: bara `src` skannas. `scripts/` (demo, migrering) är drifts- och demoverktyg som inte ingår i
 * applikationen, och `test/` och `migrations/` rör tabellerna med flit.
 */
const WRITE_EXCEPTIONS: Exception[] = [
  {
    file: 'src/pipeline/enrich.service.ts',
    table: 'articles',
    why: 'Berikningen skapar artiklarna (insert) och är enda stället som skriver fulltext. Ett skrivande steg har inget användaromfång att lägga på. Den läser inte tillbaka något.',
  },
  {
    file: 'src/pipeline/enrich.service.ts',
    table: 'skipped_items',
    why: 'Berikningen loggar överhoppade poster med hela råposten (insert), så att inget försvinner tyst (krav 7).',
  },
  {
    file: 'src/pipeline/profile-match.service.ts',
    table: 'profile_matches',
    why: 'Profilmatchningen ersätter en profils träffar för de nya artiklarna (delete och insert). Läsning av träffarna går via åtkomstmodulen.',
  },
];

const FILES = globSync('src/**/*.ts', { ignore: 'src/access/**' }).sort();
const scan = FILES.map((file) => scanSource(file, readFileSync(file, 'utf8'), WRITE_EXCEPTIONS));

describe('arkitekturregel (krav 1): bara src/access läser innehållstabellerna', () => {
  it('det finns kod att granska', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES).toContain('src/pipeline/enrich.service.ts');
    expect(FILES.some((f) => f.startsWith('src/access/'))).toBe(false);
  });

  it('ingen kod utanför src/access läser innehållstabellerna', () => {
    const findings = scan.flatMap((s) => s.findings).map((f) => `${f.file}:${f.line} ${f.message}`);
    expect(findings).toEqual([]);
  });

  it('varje undantag används fortfarande (inga kvarglömda undantag)', () => {
    const used = new Set(scan.flatMap((s) => s.usedExceptions));
    expect(WRITE_EXCEPTIONS.filter((e) => !used.has(e)).map((e) => `${e.file} ${e.table}`)).toEqual([]);
  });

  it('varje undantag har en motivering och gäller en innehållstabell i pipelinen', () => {
    for (const e of WRITE_EXCEPTIONS) {
      expect(e.why.length).toBeGreaterThan(20);
      expect(e.file.startsWith('src/pipeline/')).toBe(true);
      expect(CONTENT_TABLES).toContain(e.table);
    }
  });
});

describe('detektorn: hittar alla sätt att läsa en innehållstabell', () => {
  const hitta = (kod: string, exceptions: Exception[] = []) => scanSource('src/digest/exempel.ts', kod, exceptions).findings;

  it.each([
    ['knex(…)', "this.knex('articles').select('title')"],
    ['trx(…)', "trx('profile_matches').first()"],
    ['en variabel som heter db', "db('entity_matches').count()"],
    ['.from(…)', "knex.select('*').from('articles')"],
    ['.from med alias', "knex.select('*').from('articles as a')"],
    ['.table(…)', "knex.table('articles')"],
    ['.join(…)', "knex('entities').join('profile_matches as m', 'm.profile_id', 'entities.id')"],
    ['.leftJoin(…)', "knex('profiles').leftJoin('articles', 'a.id', 'x')"],
    ['en delfråga', "knex('entities').whereIn('id', knex('articles').select('id'))"],
    ['rå SQL', "knex.raw('select * from articles')"],
    ['rå SQL med schema och citattecken', "knex.raw('select * from public.\"skipped_items\"')"],
    ['rå SQL i en mallsträng', 'knex.raw(`select count(*) from deliveries where x = 1`)'],
    ['whereRaw med delfråga', "q.whereRaw('id in (select article_id from profile_matches)')"],
    ['tabellnamnet i en konstant', "const T = 'articles'; knex(T)"],
    ['select med fulltext', "knex('articles').select('full_text')"],
    ['en uppdatering som läser tillbaka allt', "knex('articles').where({ id: 1 }).update({ x: 1 }).returning('*')"],
    ['skrivning med läsande kedja', "knex('articles').insert({}).first()"],
    ['skrivning i fel fil', "knex('articles').insert({ raw_id: 'x' })"],
  ])('%s', (_namn, kod) => {
    expect(hitta(kod).length).toBeGreaterThan(0);
  });

  it('dynamiskt tabellnamn och dynamisk SQL räknas som brott, eftersom tabellen inte syns', () => {
    expect(hitta('knex(name).select()').map((f) => f.message)[0]).toMatch(/bokstavlig sträng/);
    expect(hitta('this.knex(`${prefix}_articles`)').length).toBeGreaterThan(0);
    expect(hitta('knex.from(tableName)').length).toBeGreaterThan(0);
    expect(hitta('query.from(tableName)').length).toBeGreaterThan(0);
    expect(hitta('knex.raw(`select * from ${tableName}`)').length).toBeGreaterThan(0);
  });

  it('rapporterar fil, rad och tabell', () => {
    const [f] = hitta("const x = 1;\nconst y = this.knex('articles');");
    expect(f).toMatchObject({ file: 'src/digest/exempel.ts', line: 2 });
    expect(f.message).toContain('articles');
  });

  it.each([
    ['en kommentar', "// from articles, knex('articles')\nconst x = 1;"],
    ['ett annat ord med samma början', "knex('article_id_map').select()"],
    ['kolumnen article_id', "knex('entities').where('article_id', 1)"],
    ['ett register som inte är innehåll', "knex('entities').select('name')"],
    ['profiler och användare', "trx('profiles').insert({}); trx('users').insert({})"],
    ['Array.from och Uint8Array.from', 'Array.from(items); Uint8Array.from(bytes)'],
    ['en route-sökväg i en dekorator', "class C { @Get('articles.csv') run() {} }"],
    ['att skapa anslutningen', "knex({ client: 'pg' })"],
    ['transaktioner', 'this.knex.transaction(async (trx) => {})'],
  ])('släpper igenom %s', (_namn, kod) => {
    expect(hitta(kod)).toEqual([]);
  });

  describe('undantag för skrivning', () => {
    const undantag: Exception[] = [{ file: 'src/digest/exempel.ts', table: 'articles', why: 'exempel för testet av detektorn' }];

    it.each([
      ['insert', "this.knex('articles').insert({ raw_id: 'x' }).onConflict().ignore().returning('id')"],
      ['delete med villkor', "trx('articles').where({ id: 1 }).whereIn('x', [1]).delete()"],
      ['update', "knex('articles').where({ id: 1 }).update({ x: 1 })"],
    ])('släpps igenom för %s i en fil med undantag', (_namn, kod) => {
      const resultat = scanSource('src/digest/exempel.ts', kod, undantag);
      expect(resultat.findings).toEqual([]);
      expect(resultat.usedExceptions).toEqual(undantag);
    });

    it('gäller bara den tabell och den fil som är angiven', () => {
      expect(scanSource('src/digest/exempel.ts', "knex('profile_matches').insert({})", undantag).findings).toHaveLength(1);
      expect(scanSource('src/digest/annan.ts', "knex('articles').insert({})", undantag).findings).toHaveLength(1);
    });

    it('gäller inte läsning, inte ens i en fil med undantag', () => {
      expect(scanSource('src/digest/exempel.ts', "knex('articles').select('title')", undantag).findings).toHaveLength(1);
      expect(scanSource('src/digest/exempel.ts', "knex('articles').where({ id: 1 }).first()", undantag).findings).toHaveLength(1);
      expect(scanSource('src/digest/exempel.ts', "knex.raw('delete from articles')", undantag).findings).toHaveLength(1);
    });
  });
});
