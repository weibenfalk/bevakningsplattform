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

## Tester

```bash
npm run db:up            # Postgres måste vara igång
npm test                 # hela sviten
npm run typecheck
```

### Testfiler

184 tester i 19 filer. "Databas" visar om filen använder `bevakning_test` (ja), bara delvis (delvis, resten är rena
enhetstester) eller inte alls (nej). Hela sviten kräver ändå att Postgres är igång, eftersom `globalSetup` skapar
testdatabasen.

| Fil | Vad den testar | Tester | Databas |
|---|---|---|---|
| `access.spec.ts` | Behörighet: arbetsytan som hård gräns (även akuta), nekade entiteter och kategorier, ingen fulltext, vitlista för `sort`, flaggade artiklar | 10 | ja |
| `raw-text.spec.ts` | Råtext lämnar aldrig systemet: mejl, export och arkitekturregel för `full_text`, samt mejl utan sammanfattning | 4 | ja |
| `render.spec.ts` | Mejlrendering: escapad text, bara http(s)-länkar i huvudlänk och "Även:" | 12 | nej |
| `export.spec.ts` | Export: roll i `AuthGuard`, `?userId=` bara för admin, skydd mot CSV-formler | 14 | delvis |
| `app.spec.ts` | Servern över HTTP: 401/403/400, admin, `PORT`, bindning till `127.0.0.1` | 10 | ja |
| `digest.spec.ts` | Utskick: andra källor inom omfånget, tröskel och sortering före begränsning | 8 | ja |
| `enrich.spec.ts` | Berikningen: kategori och arbetsyta ur fasta listor, fail closed, relevans, triage i pipelinen, stubben | 25 | delvis |
| `ingest.spec.ts` | Inläsning: teckenkodning, tidszon (Europe/Stockholm), ogiltigt datum | 22 | delvis |
| `dedupe.spec.ts` | Dubbletter och idempotens: normaliserad URL som identitet, omkörning, d02 och r09 | 12 | ja |
| `normalize-url.spec.ts` | `normalizeUrl`: spårningsparametrar, fragment, värdnamn | 5 | nej |
| `triage.spec.ts` | Triage: ogiltiga svar släpper inte igenom något, poängintervall, omgångar, avgränsning mot injektion | 15 | nej |
| `score.spec.ts` | Poängformeln: högst viktade entiteten, källvikt, färskhet, ingen NaN | 4 | nej |
| `similarity.spec.ts` | Cosinuslikhet och `isSameStory` | 8 | nej |
| `entity-matcher.spec.ts` | Entitetsmatchning: tomma termer, genitiv, Unicode-gränser, skiftläge | 11 | nej |
| `entity-import.spec.ts` | Entitetsimport: validering, ihopslagning, mappning, `meta_page_id`, inga vd-namn | 11 | ja |
| `architecture.spec.ts` | Arkitekturregel: bara `src/access` läser innehållstabellerna (en textsökning, se fel 23) | 1 | nej |
| `database-config.spec.ts` | `resolveDatabaseUrl` och att `knexProvider` använder den | 4 | nej |
| `pipeline-config.spec.ts` | Tröskeln för triage ur miljön (tom eller ogiltig ger standardvärdet, inte 0) | 2 | nej |
| `test-database.spec.ts` | Testdatabasen: `_test`-skyddet och att testerna körs mot `bevakning_test` | 6 | delvis |

Hjälpfiler (inga tester): `helpers.ts` (testapp, `seedArticles`, `scriptedLlm`), `test-database.ts`, `jest.env.ts` och
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
| `src/digest/`, `src/admin/` | Utskick och export |
| `migrations/` | Schemat. Den första migrationen är hela datamodellen (krav 2). Tabellerna för behörighet, profiler och utskick används inte av koden än |
| `scripts/demo.ts` | Demon (databasen `bevakning`) |
| `test/` | Tester (databasen `bevakning_test`) |
| `data/` | Testdata: källor, användare, entiteter och råposter |

## Platshållare som saknades i startkoden

Startkoden saknade `package.json`, migrationer, moduluppsättning, autentisering, CSV-hjälpare och testhjälpare. Dessa är
återskapade eller ersatta: `src/app.module.ts`, `src/auth/auth.guard.ts` (en platshållare, se varningen ovan),
`src/admin/csv.ts` och `test/helpers.ts`.

## Tidsantaganden

Pipelinen körs första gången 2026-10-01 07:00 svensk tid och med `raw_items_dag2.json` 2026-10-03 07:00.
Tidsstämplar utan tidszon tolkas som Europe/Stockholm.
