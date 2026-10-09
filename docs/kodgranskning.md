# Kodgranskning av den ärvda kodbasen

## Status per fel

Uppdateras varje gång ett fel rättas (se Arbetsregler i `CLAUDE.md`). Status: **rättat**, **kvar** eller
**medvetet bortvalt** (dokumenteras då som nästa steg i `ÖVERLÄMNING.md`). Allvarlighetsgrad enligt nedan:
K = kritisk, H = hög, M = medel. Beslut hänvisar till avsnittsrubriken i `docs/beslutslogg.md`.
Fel 1–11 är de kända felen i `test/kanda-fel`. De som har bokstav eller nummer över 11 hittades på vägen.

| Fel | Beskrivning | Grad | Status | Test som bevisar det | Beslut |
|---|---|---|---|---|---|
| 1 | Akuta nyheter går förbi arbetsytan (`orWhere`) | K | rättat | `test/access.spec.ts`: "en akut takvårdsnyhet når inte en användare som bara har fönsterputs" | "Fel 1 – akuta nyheter går förbi arbetsytan" |
| 2 | Nekad entitet och sökfilter gäller bara akutgrenen (samma rot som fel 1) | K | rättat | `test/access.spec.ts`: "en nekad entitet döljs även för artiklar inom användarens arbetsyta" | "Fel 1 – akuta nyheter går förbi arbetsytan" |
| 3 | `select('*')` lämnar ut `full_text` | K | rättat | `test/access.spec.ts`: "åtkomstmodulen lämnar aldrig ut fulltexten" | "Fel 3 – fulltext lämnar åtkomstmodulen, och sort är en vitlista" |
| 3b | SQL-injektion via `sort` (`orderByRaw`) | K | rättat | `test/access.spec.ts`: "sort tar bara emot vitlistade kolumner (SQL-injektion via sort)" | "Fel 3 – fulltext lämnar åtkomstmodulen, och sort är en vitlista" |
| 4 | Artikel utan affärsområde får standardvärdet takvard + fonsterputs och når alla | K | rättat | `test/enrich.spec.ts`: "ett AI-svar utan giltig arbetsyta publiceras inte, utan sparas flaggad för granskning", plus `test/access.spec.ts`: "en artikel flaggad för granskning visas aldrig, även om arbetsytan stämmer" | "Fel 4 – ett AI-svar utan giltig arbetsyta publiceras inte (fail closed)" |
| 4b | Modellen anger en giltig men felaktig arbetsyta, eller luras av injektion (r19) | K | kvar (känd risk) | saknas | "Fel 4 …", under Känd risk och Nästa steg |
| 5 | Originaltexten blir sammanfattning när AI-svaret är ogiltigt | K | rättat | `test/enrich.spec.ts`: "när AI:n svarar fel sparas ingen sammanfattning (inte originaltexten) och artikeln flaggas", plus `test/raw-text.spec.ts` (mejl, export och arkitekturregel) | "Fel 5 – originaltexten används aldrig som sammanfattning" |
| 6 | HTML i sammanfattningen escapas inte (`marked`) | K | kvar | `test/kanda-fel`: "fel 6: HTML i sammanfattningen escapas" | – |
| 7 | `javascript:`-länkar renderas i mejlet | K | kvar | `test/kanda-fel`: "fel 7: länkar som inte är http(s) renderas inte" | – |
| 8 | `normalizeUrl` tar bara bort varannan spårningsparameter | H | kvar | `test/kanda-fel`: "fel 8: alla spårningsparametrar tas bort ur URL:en …" | – |
| 9 | Tomt alias eller tom domän matchar allt | H | kvar | `test/kanda-fel`: "fel 9: en entitet utan domän matchar inte varje text" | – |
| 10 | Svenska böjningar matchar inte (Takvårdarnas) | H | kvar | `test/kanda-fel`: "fel 10: alias med svensk böjning matchar (Takvårdarnas)" | – |
| 11 | Orelaterade texter räknas som samma story (vektorerna normaliseras inte) | H | kvar | `test/kanda-fel`: "fel 11: två orelaterade texter räknas inte som samma story" | – |
| 12 | `deny_categories` lästes in men användes aldrig, och artiklarna saknade kategori | K | rättat | `test/access.spec.ts`: "en nekad kategori döljs även för artiklar inom användarens arbetsyta" och "… även akuta artiklar och sökträffar", plus `test/enrich.spec.ts` (kategori ur fast lista, minst en) | "`deny_categories` gäller nu, och kategorin sätts av berikningen" |
| 13 | `renderDigest` kraschar på `summary = null`. Uppstod när fel 5 gjorde sammanfattningen nullbar, inget ärvt fel | M | rättat | `test/raw-text.spec.ts`: "klarar en artikel utan sammanfattning (null) och skriver inte "null"" | "Fel 5 – originaltexten används aldrig som sammanfattning" |
| 14 | Trasig teckenkodning vid inläsning (r20, "FÃ¶nster"). Upptäcktes i demon efter fel 4 | H | kvar | saknas | "Fel 4 …", under demons resultat |

Tabellen listar felen i incidenten och de kända felen. "Fynd per fil" längre ned gäller fortfarande för det som
inte är rättat, bland annat `otherSources` och tröskeln `>` i `digest.service.ts`, `?userId=` i
`export.controller.ts`, `triage.service.ts`, `score.ts`, `trend.service.ts`, `entity-import.service.ts` och
arkitekturtestet. De får en rad i tabellen när de tas upp. Inga fel är hittills medvetet bortvalda.

Bedömd som om den gick i produktion. Allvarlighetsgrad: **K** = kritisk (läcker data eller är ett säkerhetshål),
**H** = hög (ger fel resultat), **M** = medel.
Tester för rättade fel ligger i den vanliga sviten, och de som återstår ligger i `test/kanda-fel/kanda-fel.spec.ts`.

## Incidenten: varför Anna fick en konkursnyhet om takvård med hela artikeln

Det finns tre oberoende orsaker, och var och en räcker ensam:

1. `article-access.service.ts`: `.orWhere('urgency', 'akut')` släpper förbi alla akuta artiklar oavsett arbetsyta (fel 1).
2. `enrich.service.ts` och `pipeline.config.ts`: när modellen inte anger `business_areas` får artikeln standardvärdet
   `['takvard', 'fonsterputs']`. Stubben svarar alltid `[]`, så allt hamnar hos båda (fel 4).
3. `enrich.service.ts`: när AI-svaret är ogiltigt blir `summary = item.text.slice(0, 600)`. En kort artikel skickas då
   ut i sin helhet (fel 5). `render.ts` renderar den dessutom som Markdown utan att escapa (fel 6).

Demon visar också att **r11 (koncernens möjliga börsnotering) når både Kalle och Anna**, vilket är minst lika allvarligt.

## Fynd per fil

| Fil | Grad | Problem | Beslut |
|---|---|---|---|
| `access/article-access.service.ts` | K | `orWhere` för akuta förbigår omfånget. Eftersom AND binder hårdare än OR gäller nekade entiteter och sökfiltret bara akutgrenen (fel 1, 2). `deny_categories` används aldrig. `select('*')` lämnar ut `full_text` (fel 3). `orderByRaw(opts.sort)` ger SQL-injektion. | Skriv om |
| `access/content-scope.service.ts` | H | Saknar tillåtna listor, nekade källor och högsta brådska enligt specifikationen. | Bygg ut |
| `admin/export.controller.ts` | K | Vem som helst kan ange `?userId=` och exportera en annan användares innehåll. `sort` skickas vidare till SQL. Inget skydd mot CSV-formler. | Skriv om |
| `digest/digest.service.ts` | K | `otherSources` läser `articles` direkt förbi åtkomstmodulen. `...a` sprider hela raden. Tröskeln använder `>` i stället för `>=`. En databasfråga per artikel (N+1). Ingen hantering av uppföljning eller tunna utgåvor. | Skriv om |
| `digest/render.ts` | K | `marked.parseInline(summary)` ger HTML-injektion i mejlet (fel 6). `javascript:`-länkar släpps igenom (fel 7). Saknar plaintext, dark mode och List-Unsubscribe. | Behåll `escapeHtml`, skriv om resten |
| `pipeline/enrich.service.ts` | K | Modellen bestämmer arbetsyta, vilket öppnar för injektion (se r19). Faller tillbaka på originaltexten. `onConflict('raw_id').ignore()` gör att uppdateringar (d02) ignoreras och att det andra r09 försvinner tyst. Räknar aldrig ut `relevance`. Ingen loggning av körningar. | Skriv om |
| `pipeline/triage.service.ts` | H | `minScore` är 0 och fel ger 0, så allt går vidare (`0 >= 0`). Det blir 700 dyra berikningar i stället för 35. Använder inte `extractJson`. Ingen avgränsning mot injektion. | Rätta |
| `pipeline/normalize-url.ts` | H | Tar bort parametrar inne i `forEach`, så varannan hoppas över. r01 och r03 dedupliceras inte (fel 8). | Rätta |
| `pipeline/entity-matcher.ts` | H | Tomt alias eller tom domän matchar allt (fel 9). `\b` hanterar inte å, ä och ö. Böjningar som "Takvårdarnas" missas (fel 10). Vanliga ord ger falska träffar ("klart glas", "rena fönster", "tak team"). | Skriv om |
| `pipeline/similarity.ts` | H | Antar vektorer med längd 1, men stubbens vektorer är det inte. Orelaterade texter blir "samma story" (fel 11). Tröskeln 0,92 är gissad, inte kalibrerad. | Rätta |
| `pipeline/score.ts` | M | Använder första entiteten i stället för den högst viktade. Saknar faktorn ×0,60 för uppföljning. Okänd `watch_level` eller källa ger NaN. | Behåll strukturen, rätta |
| `pipeline/trend.service.ts` | M | Räknar rader i `entity_matches`, inte unika artiklar. Dubbletter och flera alias blåser upp siffran. Använder `created_at` i stället för `published_at`. | Rätta |
| `import/entity-import.service.ts` | H | Ingen validering ("Hög", tomt namn, EXEMPEL-raden). Namnen trimmas inte, så Rikstak blir en dubblett. `merge` skriver över alias. `cast: true` förstör `meta_page_id` (stora tal). Lagrar vd-namn, som är personuppgifter systemet inte behöver. | Skriv om |
| `llm/stub.provider.ts` | M | `split(/\W+/)` delar ord vid å, ä och ö. Samma svar för alla texter ger meningslösa testresultat. | Behåll idén, förbättra |
| `llm/*`, `types.ts`, `db/knex.provider.ts` | | Rimlig grund. `knexProvider` stänger inte sin pool. | Behåll |
| `test/architecture.spec.ts` | K | Letar bara efter textsträngen `from articles`. `knex('articles')` fångas inte, så testet är grönt fast regeln bryts. | Skriv om |
| `test/access.spec.ts` | H | Testar bara att rätt saker syns, aldrig att fel saker döljs. Akutfallet testas inte. | Bygg ut |

## Fällor i testdatan

- **entiteter.csv:** en EXEMPEL-rad, en rad utan namn, Rikstak som dubblett med ett mellanslag på slutet, "Hög" i
  stället för "high", olika format på organisationsnummer, ett `meta_page_id` större än `Number.MAX_SAFE_INTEGER` och
  entiteter utan domän.
- **profiles.json:** `pf-tak-pris` har en oparad parentes och `pf-puts` en inledande wildcard. Båda ska ge syntaxfel.
  `pf-regler` har `NOT Rättelse` och missar därför rättelsen d05, som är en regeländring.
- **Råposter:**
  - **Dubbletter:** r01 och r03 är samma kungörelse med utm-parametrar. r16/r17 och r01/r02 är samma story. d01 har samma URL som r01.
  - **Falska träffar:** r08, r10, r15 och r18.
  - **Innehåll som kan missbrukas:** r19 har en promptinjektion och ett obekräftat akutrykte. r22 har HTML i rubriken.
  - **Format:** r20 har trasig teckenkodning och r21 saknar tidszon. r09 har dubblett-id. r14 är på engelska.
  - **Siffror och rättelser:** r06 och d05 testar hallucinationsskyddet och hanteringen av rättelser.
  - **Trend:** d04 gör Rikstak till trend.
  - **Uppföljningar:** d02 och d03.
