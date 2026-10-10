# Bevakningsplattform

Arbetsprov: en plattform för omvärldsbevakning (NestJS, TypeScript i strikt läge, PostgreSQL och Knex). Repot började som
en ärvd kodbas med allvarliga buggar och säkerhetshål. Vad som är rättat, vad som återstår och varför står i
[`docs/kodgranskning.md`](docs/kodgranskning.md) (statustabellen överst) och [`docs/beslutslogg.md`](docs/beslutslogg.md).

## Kom igång

Kräver Node 22.12 eller senare och Docker.

```bash
npm install
npm run db:up          # startar PostgreSQL i Docker (port 5433)
npm run migrate        # skapar tabellerna
npm run demo           # kör pipelinen på testdatan och fyller databasen `bevakning`
npm start              # startar servern på http://127.0.0.1:3000
npm run query -- "Rikstak AND NOT pumpa*"   # prövar en fråga mot testdatan, utan databas
```

Stoppa och töm databasen med `npm run db:down`.

## Starta servern

`npm start` startar `AppModule` (`src/main.ts`).

| Inställning | Standard | Vad |
|---|---|---|
| `PORT` | `3000` | Port. Ett ogiltigt värde ger 3000. |
| `HOST` | `127.0.0.1` | Adress. Servern är bara nåbar från den egna datorn, se varningen nedan. |
| `DATABASE_URL` | den lokala Docker-databasen | Krävs i produktion (`NODE_ENV=production`). |
| `ADMIN_USER_IDS` | tom (ingen är admin) | Kommaseparerade användar-id som är admin. |

> **Varning: `x-user-id` är en platshållare, inte inloggning.** Servern litar på headern `x-user-id` och kontrollerar
> inte att anroparen är den hen utger sig för att vara. Vem som helst som når servern kan skicka en annan användares id
> (även en admins) och få hens innehåll. Därför lyssnar servern som standard bara på `127.0.0.1`. Ändra inte `HOST` till
> något nåbart utifrån förrän riktig inloggning finns (se fel 18 i statustabellen). Rollen "admin" kommer från serverns
> konfiguration (`ADMIN_USER_IDS`) och inte från anropet, men den skyddar bara så länge identiteten är äkta.

## Exportera artiklar (curl)

Kör `npm run demo` först så att det finns artiklar. Testanvändarna är `u-mikael` (koncern, takvård och fönsterputs),
`u-kalle` (takvård) och `u-anna` (fönsterputs).

```bash
# Som vanlig användare: Anna får bara fönsterputs
curl -H 'x-user-id: u-anna' http://127.0.0.1:3000/export/articles.csv

# Utan användare: 401
curl -i http://127.0.0.1:3000/export/articles.csv

# En vanlig användare kan inte exportera någon annans innehåll: 403
curl -i -H 'x-user-id: u-anna' 'http://127.0.0.1:3000/export/articles.csv?userId=u-kalle'

# Sortering (vitlista: relevance, published_at, impact, raw_id, id; asc eller desc). Annat ger 400
curl -H 'x-user-id: u-kalle' 'http://127.0.0.1:3000/export/articles.csv?sort=published_at%20desc'
```

Som admin startar du servern med `ADMIN_USER_IDS` och anger vem du vill se som:

```bash
ADMIN_USER_IDS=u-mikael npm start

# Mikael (admin) exporterar som Kalle
curl -H 'x-user-id: u-mikael' 'http://127.0.0.1:3000/export/articles.csv?userId=u-kalle'

# Samma anrop som en icke-admin ger 403, även om anroparen skickar en roll i anropet
curl -i -H 'x-user-id: u-anna' -H 'x-user-role: admin' 'http://127.0.0.1:3000/export/articles.csv?userId=u-kalle'
```

Svaret är CSV med kolumnerna `id,title,url,relevance`. Aldrig fulltext. Celler som börjar med `=`, `+`, `-` eller `@`
får ett inledande `'` så att de inte tolkas som formler i Excel.

## Vad demon visar

`npm run demo` läser in entitetsregistret och dag 1-råposterna (`raw_items.json` + `raw_items_extra.json`),
kör dem genom pipelinen med AI-stubben och skriver ut vad varje användare får se, vilka poster som hoppades över och
varför. En förhandsvisning av utskicket per användare hamnar i `out/` (öppna i webbläsaren). Stubben är en ersättare
för modellen och sätter arbetsyta och påverkan efter nyckelord, så poängen visar flödet och är ingen bedömning.

`npm run demo -- --trasig-ai` gör samma sak men med en AI som svarar ogiltigt, som en riktig modell ibland gör.
Artiklarna flaggas då för granskning och publiceras inte, och originaltexten används aldrig som sammanfattning.

Demon läser också in `data/profiles.json`. De två trasiga profilerna (`pf-tak-pris`, `pf-puts`) loggas med felmeddelande och
hoppas över. De övriga körs mot de nya artiklarna efter berikningen, och träffarna sparas i `profile_matches`. Demon visar
per användare vilka av hens egna profiler som träffade vilka artiklar och med vilken term, och mejlet i `out/` har
"Varför: profil (term)" under artikeln. Profilerna styr inte urvalet: Kalle får r06 (rotavdraget) även om ingen av hans profiler träffar den.

Demon kör sedan **dag 2** (`raw_items_dag2.json`, klockan 2026-10-03 07:00) och visar vad varje användare får: d01 hoppas över som dubblett, d02 uppdaterar r02
(ny text och poäng, markerad som uppföljning, och skickas inte igen till dem som fick r02), och d05 (en rättelse) är alltid med.
Utskicken sparas i `editions`, `deliveries` och `delivery_items`, så det som skickats dag 1 skickas inte om. Förhandsvisningar för dag 2 hamnar i `out/<användare>-dag2.html`.

Demon skriver också ut en sammanfattning av körningarna från tabellen `pipeline_runs` (steg, status, tid, antal in, ut och överhoppade). Varje steg loggar sig själv, så sammanfattningen kommer från databasen och inte från returvärdena.

## Frågespråket (`npm run query`)

`npm run query -- "<fråga>"` visar vad frågespråket (`src/query/`) gör med en fråga. Ingen databas behövs, datan
läses direkt från `data/`. Dag 1 är `raw_items.json` och `raw_items_extra.json`, alltså samma som demon läser (med r19–r22). Dag 2 är `raw_items_dag2.json`. Felkodad text repareras som i pipelinen. r09 förekommer två gånger i dag 1 och visas därför två gånger. Skriptet skriver ut tre saker:

1. **Tokens**, en per rad med position.
2. **Trädet**, indenterat.
3. **Träffar**: vilka artiklar i dag 1 och dag 2 som matchar, och vilken term som gav träffen (termer under `NOT` räknas inte).

```bash
npm run query -- '(Rikstak OR Takvårdarna) AND NOT pumpa*'
npm run query -- '"Rena Fönster" OR fönsterput*'
npm run query -- 'Rikstak NEAR/3 takmålning'
```

Vid syntaxfel visas frågan med en `^` under positionen, och skriptet avslutas med kod 1. De två trasiga profilerna
i `data/profiles.json` ger till exempel:

```text
$ npm run query -- '*putsning OR fallskydd'
Syntaxfel:
  *putsning OR fallskydd
  ^
  Wildcard (*) får bara stå sist i ett ord, till exempel pumpa*, inte först eller mitt i (position 1)
```

Kom ihåg att citera frågan i skalet (enkla citattecken), annars tolkar skalet parenteser, `*` och `"`.
Samma frågespråk används av pipelinen (profilmatchning efter berikningen). Regler och val står i `docs/beslutslogg.md`.

## Tester

```bash
npm run db:up            # Postgres måste vara igång
npm test                 # hela sviten
npm run typecheck
```

### Testfiler

481 tester i 34 filer. "Databas" visar om filen använder `bevakning_test` (ja), bara delvis (delvis, resten är rena
enhetstester) eller inte alls (nej). Hela sviten kräver ändå att Postgres är igång, eftersom `globalSetup` skapar
testdatabasen.

| Fil | Vad den testar | Tester | Databas |
|---|---|---|---|
| `access.spec.ts` | Behörighet: arbetsytan som hård gräns (även akuta), tillåtna och nekade kategorier, källor och entiteter (nekat vinner), högsta brådska, ingen fulltext, vitlista för `sort`, flaggade artiklar | 27 | ja |
| `raw-text.spec.ts` | Råtext lämnar aldrig systemet: mejl, export och arkitekturregel för `full_text`, samt mejl utan sammanfattning | 4 | ja |
| `render.spec.ts` | Mejlrendering: escapad text, bara http(s)-länkar i huvudlänk och "Även:" | 12 | nej |
| `export.spec.ts` | Export: roll i `AuthGuard`, `?userId=` bara för admin, skydd mot CSV-formler | 14 | delvis |
| `app.spec.ts` | Servern över HTTP: 401/403/400, admin, `PORT`, bindning till `127.0.0.1` | 10 | ja |
| `digest.spec.ts` | Utskick: andra källor inom omfånget, tröskel och sortering före begränsning | 8 | ja |
| `enrich.spec.ts` | Berikningen: kategori och arbetsyta ur fasta listor, fail closed, relevans, triage i pipelinen, stubben | 26 | delvis |
| `ingest.spec.ts` | Inläsning: teckenkodning, tidszon (Europe/Stockholm), ogiltigt datum | 25 | delvis |
| `dedupe.spec.ts` | Dubbletter och idempotens: normaliserad URL som identitet, omkörning, d02 och r09 | 12 | ja |
| `normalize-url.spec.ts` | `normalizeUrl`: spårningsparametrar, fragment, värdnamn | 5 | nej |
| `triage.spec.ts` | Triage: ogiltiga svar släpper inte igenom något, poängintervall, omgångar, avgränsning mot injektion | 15 | nej |
| `score.spec.ts` | Poängformeln: högst viktade entiteten, källvikt, färskhet, ingen NaN | 6 | nej |
| `similarity.spec.ts` | Cosinuslikhet och `isSameStory` | 8 | nej |
| `entity-matcher.spec.ts` | Entitetsmatchning: tomma termer, genitiv, Unicode-gränser, skiftläge | 11 | nej |
| `entity-import.spec.ts` | Entitetsimport: validering, ihopslagning, mappning, `meta_page_id`, inga vd-namn | 11 | ja |
| `architecture.spec.ts` | Krav 1: bara `src/access` läser innehållstabellerna (TypeScript-kompilatorn, se fel 23), undantag bara för skrivning i pipelinen, och detektorn mot 18 sätt att läsa | 38 | nej |
| `database-config.spec.ts` | `resolveDatabaseUrl` och att `knexProvider` använder den | 4 | nej |
| `pipeline-config.spec.ts` | Tröskeln för triage ur miljön (tom eller ogiltig ger standardvärdet, inte 0) | 2 | nej |
| `query-tokenizer.spec.ts` | Frågespråkets tokenizer: ord, fraser, NEAR, å/ä/ö, wildcard och syntaxfel med position | 30 | nej |
| `query-parser.spec.ts` | Frågespråkets parser: träd, prioritet, implicit AND, fält, NEAR och syntaxfel (oparad parentes m.fl.) och fält som inte stöds | 50 | nej |
| `query-evaluator.spec.ts` | Frågespråkets utvärdering: ord, fraser, prefix, fält, NEAR, svenska regler | 31 | nej |
| `query-profiles.spec.ts` | Profilerna i `data/profiles.json`: de två trasiga ger fel, de giltiga träffar rätt artiklar | 9 | nej |
| `profile-matching.spec.ts` | Profiler in (versioner, trasiga hoppas över), matchning i pipelinen, idempotens, ägarens omfång, fält som saknar data (fail closed) | 21 | ja |
| `profile-digest.spec.ts` | "Varför: …" i mejlet: bara egna profiler och senaste version, urvalet oförändrat | 10 | delvis |
| `updates.spec.ts` | Uppdateringar (d02 uppdaterar r02): ny text och poäng, uppföljning, äldre version, ogiltigt svar | 13 | ja |
| `delivery.spec.ts` | Utskicksloggen i utgåvor och leveranser (inget skickas igen), uppföljningar och rättelser som alltid är med | 22 | ja |
| `day2.spec.ts` | Dag 2 med de riktiga posterna: d01, d02, d05 och vad varje användare får | 8 | ja |
| `correction.spec.ts` | Vad som räknas som rättelse | 11 | nej |
| `pipeline-runs.spec.ts` | Krav 7: `pipeline_runs` får en rad per körning av inläsning, berikning och profilmatchning (start, slut, antal, fel) | 10 | ja |
| `query-data.spec.ts` | Datan i `npm run query`: samma filer som demon (inkl. r19–r22) och reparerad teckenkodning | 2 | nej |
| `query-describe.spec.ts` | Utskriften i `npm run query`: tokens, träd, träffande termer och felmarkering | 12 | nej |
| `query-no-regex.spec.ts` | Krav 4: ingen regex i `src/query` (kontrolleras med TypeScript-kompilatorn) | 3 | nej |
| `test-database.spec.ts` | Testdatabasen: `_test`-skyddet och att testerna körs mot `bevakning_test` | 5 | delvis |

Hjälpfiler (inga tester): `helpers.ts` (testapp, `seedArticles`, `scriptedLlm`), `architecture-scan.ts` (detektorn bakom arkitekturtestet), `test-database.ts`, `jest.env.ts` och
`jest.global-setup.ts`.

**Testerna har en egen databas.** De kör mot `bevakning_test` på samma Postgres-server som demon, och `npm test`
rör därför aldrig demodatan i `bevakning`. Testdatabasen skapas automatiskt första gången (Jest `globalSetup`, se
`test/jest.global-setup.ts`) och tabellerna skapas av migrationerna, så ingen manuell uppsättning behövs. Du behöver
inte köra `npm run migrate` för testerna.

- Testerna tvingar sin egen `DATABASE_URL` (`test/jest.env.ts`), även om miljön pekar någon annanstans.
- `TEST_DATABASE_URL` byter testdatabas, till exempel i CI. Namnet **måste sluta på `_test`**. Testhjälparna vägrar
  annars köra, eftersom de tömmer tabellerna (`test/test-database.ts`).
- Serverns `DATABASE_URL` räknas aldrig för testerna, eftersom den kan peka på en databas som inte får tömmas.
- `npm run db:down` tar bort båda databaserna.
- Loggen är tyst i testerna (trasiga svar testas med flit). `TEST_LOGS=1 npm test` visar den när något felsöks.
  Produktionen och demon loggar som vanligt.

## Struktur

| Mapp / fil | Vad |
|---|---|
| `src/main.ts` | Startar servern |
| `src/access/` | Den enda vägen in till artiklar: omfång, nekade entiteter och kategorier, kolumnlista |
| `src/pipeline/` | Förberedelse, dubblettkontroll, triage, berikning, poäng, entitetsmatchning |
| `src/llm/` | `LlmProvider`-gränssnittet och stubben |
| `src/query/` | Frågespråket: tokenizer, parser, utvärdering |
| `src/profiles/` | Läser in profiler ur `data/profiles.json`, versionerade |
| `src/pipeline/pipeline.service.ts`, `profile-match.service.ts`, `run-log.service.ts` | Hela körningen (profiler, berikning, profilmatchning), matchningen i batch och körloggen i `pipeline_runs` |
| `src/digest/`, `src/admin/` | Utskick och export |
| `migrations/` | Schemat. Den första migrationen är hela datamodellen (krav 2). Utgåvor, leveranser och leveransposter används för utskicksloggen. Övriga tabeller för behörighet och publikationer används inte av koden än. Efter en ändring av den första migrationen måste databasen skapas om (`npm run db:down`, `db:up`, `migrate`) |
| `scripts/demo.ts` | Demon (databasen `bevakning`) |
| `scripts/query.ts` | `npm run query`: prövar en fråga mot testdatan |
| `test/` | Tester (databasen `bevakning_test`) |
| `data/` | Testdata: källor, användare, entiteter och råposter |

## Platshållare som saknades i startkoden

Startkoden saknade `package.json`, migrationer, moduluppsättning, autentisering, CSV-hjälpare och testhjälpare. Dessa är
återskapade eller ersatta: `src/app.module.ts`, `src/auth/auth.guard.ts` (en platshållare, se varningen ovan),
`src/admin/csv.ts` och `test/helpers.ts`.

## Tidsantaganden

Pipelinen körs första gången 2026-10-01 07:00 svensk tid och med `raw_items_dag2.json` 2026-10-03 07:00.
Tidsstämplar utan tidszon tolkas som Europe/Stockholm.
