# Kodgranskning av den ärvda kodbasen

## Status per fel

Uppdateras varje gång ett fel rättas (se Arbetsregler i `CLAUDE.md`). Status: **rättat**, **kvar** eller
**medvetet bortvalt** (dokumenteras då som nästa steg i `ÖVERLÄMNING.md`). Allvarlighetsgrad enligt nedan:
K = kritisk, H = hög, M = medel. Beslut hänvisar till avsnittsrubriken i `docs/beslutslogg.md`.
Fel 1–11 är de kända felen i `test/kanda-fel`. Tester för rättade fel har flyttats till den vanliga sviten. De som har bokstav eller nummer över 11 hittades på vägen.

| Fel | Beskrivning | Grad | Status | Test som bevisar det | Beslut |
|---|---|---|---|---|---|
| 1 | Akuta nyheter går förbi arbetsytan (`orWhere`) | K | rättat | `test/access.spec.ts`: "en akut takvårdsnyhet når inte en användare som bara har fönsterputs" | "Fel 1 – akuta nyheter går förbi arbetsytan" |
| 2 | Nekad entitet och sökfilter gäller bara akutgrenen (samma rot som fel 1) | K | rättat | `test/access.spec.ts`: "en nekad entitet döljs även för artiklar inom användarens arbetsyta" | "Fel 1 – akuta nyheter går förbi arbetsytan" |
| 3 | `select('*')` lämnar ut `full_text` | K | rättat | `test/access.spec.ts`: "åtkomstmodulen lämnar aldrig ut fulltexten" | "Fel 3 – fulltext lämnar åtkomstmodulen, och sort är en vitlista" |
| 3b | SQL-injektion via `sort` (`orderByRaw`) | K | rättat | `test/access.spec.ts`: "sort tar bara emot vitlistade kolumner (SQL-injektion via sort)" | "Fel 3 – fulltext lämnar åtkomstmodulen, och sort är en vitlista" |
| 4 | Artikel utan affärsområde får standardvärdet takvard + fonsterputs och når alla | K | rättat | `test/enrich.spec.ts`: "ett AI-svar utan giltig arbetsyta publiceras inte, utan sparas flaggad för granskning", plus `test/access.spec.ts`: "en artikel flaggad för granskning visas aldrig, även om arbetsytan stämmer" | "Fel 4 – ett AI-svar utan giltig arbetsyta publiceras inte (fail closed)" |
| 4b | Modellen anger en giltig men felaktig arbetsyta, eller luras av injektion (r19) | K | kvar (känd risk) | saknas | "Fel 4 …", under Känd risk och Nästa steg |
| 5 | Originaltexten blir sammanfattning när AI-svaret är ogiltigt | K | rättat | `test/enrich.spec.ts`: "när AI:n svarar fel sparas ingen sammanfattning (inte originaltexten) och artikeln flaggas", plus `test/raw-text.spec.ts` (mejl, export och arkitekturregel) | "Fel 5 – originaltexten används aldrig som sammanfattning" |
| 6 | HTML i sammanfattningen escapas inte (`marked`) | K | rättat | `test/render.spec.ts`: "HTML i sammanfattningen escapas" och "Markdown tolkas inte, utan visas som den står" | "Fel 6 och 7 – mejlet renderar bara escapad text och http(s)-länkar" |
| 7 | `javascript:`-länkar renderas i mejlet (huvudlänk och `otherSources`) | K | rättat | `test/render.spec.ts`: "bara http- och https-länkar" (sju adresser) och "länkar i otherSources följer samma regel" | "Fel 6 och 7 – mejlet renderar bara escapad text och http(s)-länkar" |
| 8 | `normalizeUrl` tar bara bort varannan spårningsparameter | H | kvar | `test/kanda-fel`: "fel 8: alla spårningsparametrar tas bort ur URL:en …" | – |
| 9 | Tomt alias eller tom domän matchar allt | H | rättat | `test/entity-matcher.spec.ts`: "en entitet utan domän (\"\") matchar inte varje text", tomt alias, blanksteg och "riktiga termer matchar fortfarande …" | "Fel 9 – tomma termer matchar inget" |
| 10 | Svenska böjningar matchar inte (Takvårdarnas) | H | kvar | `test/kanda-fel`: "fel 10: alias med svensk böjning matchar (Takvårdarnas)" | – |
| 11 | Orelaterade texter räknas som samma story (vektorerna normaliseras inte) | H | kvar | `test/kanda-fel`: "fel 11: två orelaterade texter räknas inte som samma story" | – |
| 12 | `deny_categories` lästes in men användes aldrig, och artiklarna saknade kategori | K | rättat | `test/access.spec.ts`: "en nekad kategori döljs även för artiklar inom användarens arbetsyta" och "… även akuta artiklar och sökträffar", plus `test/enrich.spec.ts` (kategori ur fast lista, minst en) | "`deny_categories` gäller nu, och kategorin sätts av berikningen" |
| 13 | `renderDigest` kraschar på `summary = null`. Uppstod när fel 5 gjorde sammanfattningen nullbar, inget ärvt fel | M | rättat | `test/raw-text.spec.ts`: "klarar en artikel utan sammanfattning (null) och skriver inte "null"" | "Fel 5 – originaltexten används aldrig som sammanfattning" |
| 14 | Felkodad text vid inläsning: r20 kommer som "FÃ¶nster" (UTF-8 lästa som Latin-1) och ingen kod i inläsningen upptäcker eller reparerar det. Upptäcktes i demon efter fel 4 | H | kvar | saknas. Test skrivs när felet tas | "Fel 4 …", under demons resultat |
| 15 | `otherSources` läser `articles` direkt förbi åtkomstmodulen och visar källor utanför omfånget | K | rättat | `test/digest.spec.ts`: "visar aldrig källor från artiklar utanför användarens arbetsyta", "… flaggade för granskning" och "visar inte nekade entiteter eller kategorier som andra källor" | "`otherSources` går via åtkomstmodulen" |
| 16 | `?userId=` i exporten låter vem som helst exportera en annan användares innehåll | K | rättat (autentisering saknas) | `test/export.spec.ts`: "en vanlig användare kan inte exportera en annan användares innehåll" och guard-testerna | "Exporten – `?userId=` bara för admin, och skydd mot CSV-formler" |
| 17 | CSV-export saknar skydd mot formelinjektion (`=`, `+`, `-`, `@`) | H | rättat | `test/export.spec.ts`: "toCsv: skydd mot formelinjektion" | "Exporten – `?userId=` bara för admin, och skydd mot CSV-formler" |
| 18 | Riktig autentisering saknas (`AuthGuard` litar på `x-user-id`), så rollkontrollen i fel 16 kan kringgås | K | kvar | saknas | "Exporten – `?userId=` bara för admin …", under Känd begränsning |
| 19 | `TriageService` släpper igenom allt: `minScore` är 0 och ett fel ger 0 (`0 >= 0`). Använder inte `extractJson` och har ingen avgränsning mot injektion. Ger 700 dyra berikningar i stället för 35 | H | kvar | saknas. Test skrivs när felet tas | – |
| 20 | Poängformeln (`score.ts`) använder första entiteten i stället för den högst viktade (rättat), saknar faktorn ×0,60 för uppföljning (kvar, se fel 26), och en okänd `watch_level` eller källa ger NaN (rättat) | M | delvis rättat | `test/score.spec.ts`: "använder den högst viktade entiteten, oavsett ordning" och "en okänd bevakningsnivå ger inte NaN". Uppföljningsfaktorn saknar test | "`relevance` räknas ut i berikningen (score.ts kopplas in)" |
| 21 | Trendberäkningen (`trend.service.ts`) räknar rader i `entity_matches` i stället för unika artiklar, så dubbletter och flera alias blåser upp siffran. Använder `created_at` i stället för `published_at` | M | kvar | saknas. Test skrivs när felet tas | – |
| 22 | Entitetsimporten saknar validering ("Hög", tomt namn, EXEMPEL-raden), trimmar inte namn (Rikstak blir dubblett), `merge` skriver över alias, `cast: true` förstör stora `meta_page_id`, och vd-namn (personuppgifter) lagras | H | rättat | `test/entity-import.spec.ts` (11 tester): sju entiteter utan EXEMPEL, tomt namn och dubblett; rapport med radnummer; ihopslagna alias; "Hög" → high med loggad mappning; `meta_page_id` som text; inga vd-namn; inga tomma termer; idempotent; validering av nivå och affärsområde | "Entitetsimporten – validerad, ihopslagen och utan personuppgifter" |
| 23 | Arkitekturtestet söker bara efter textsträngen `from articles`, så `knex('articles')` fångas inte och testet är grönt fast regeln bryts (`DigestService` gjorde det tills fel 15). Ska använda TypeScript-kompilatorn | K | kvar | saknas. Test skrivs när felet tas | – |
| 24 | Tidsstämpel utan tidszon (r21, "2026-09-30 23:30:00") sparas som UTC, eftersom databasen kör `Etc/UTC`. Antagandet är Europe/Stockholm, så tiden blir två timmar fel och kan hamna på fel dygn | H | kvar | saknas. Test skrivs när felet tas | – |
| 25 | `relevance` räknas aldrig ut (`score.ts` anropas inte), så kolumnen är tom och utskicket blir tomt. `entity_ids` sätts aldrig heller | H | rättat (med begränsningar) | `test/enrich.spec.ts`: "relevance räknas ut och sparas, och utskicket blir inte tomt", "källvikten kommer från sources.json …", "färskheten räknas mot den fasta klockan …", "entitetsvikten kommer från den högst viktade matchade entiteten …", "en okänd källa kan inte poängsättas …", plus `test/score.spec.ts` | "`relevance` räknas ut i berikningen (score.ts kopplas in)" |
| 26 | Trend- (×1,25) och uppföljningsfaktorn (×0,60) är inte inkopplade i poängen. Entitetsvikten är missvisande tills fel 9 och 10 är rättade | M | kvar (känd begränsning) | saknas. Test skrivs när felet tas | "`relevance` räknas ut i berikningen (score.ts kopplas in)", under Kända begränsningar |
| 27 | Utskickets tröskel är `>` i stället för `>=`, så en artikel med exakt 55 poäng faller bort (stubbens standardpoäng blev exakt 55) | M | rättat | `test/digest.spec.ts`: "en artikel med exakt tröskelvärdet tas med, och en under den gör det inte" | "Utskicket – tröskel `>=` och sortering före begränsning" |
| 28 | `DigestService` begränsar till 18 artiklar innan den sorterar på brådska, så mer relevanta artiklar kan tränga ut en akut | H | rättat | `test/digest.spec.ts`: "sorterar före begränsningen: en akut artikel med lägre poäng tränger inte ut av mer relevanta" och "inom samma brådska kommer den mest relevanta först" | "Utskicket – tröskel `>=` och sortering före begränsning" |

Tabellen listar felen i incidenten, de kända felen och fynden i "Fynd per fil" som har fått en egen rad. Rader utan
test ("saknas") får sitt test först när felet tas, enligt regel 1 i `CLAUDE.md`. Fel 19–28 fortsätter numreringen,
eftersom 13–18 redan används. Inga fel är hittills medvetet bortvalda.

Fynd i "Fynd per fil" som ännu **inte** har en rad i tabellen: att `ContentScopeService` saknar tillåtna listor, nekade källor och högsta brådska,
`onConflict('raw_id').ignore()` i `enrich.service.ts` (uppdateringar d02 och det andra r09 försvinner), att
`relevance` aldrig räknas ut, `split(/\W+/)` i stubben och att `knexProvider` inte stänger sin pool.

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
