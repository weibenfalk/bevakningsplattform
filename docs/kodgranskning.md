# Kodgranskning av den ärvda kodbasen

## Status per fel

Uppdateras varje gång ett fel rättas (se Arbetsregler i `CLAUDE.md`). Status: **rättat**, **kvar** eller
**medvetet bortvalt** (dokumenteras då som nästa steg i `ÖVERLÄMNING.md`). Allvarlighetsgrad enligt nedan:
K = kritisk, H = hög, M = medel. Beslut hänvisar till avsnittsrubriken i `docs/beslutslogg.md`.
Fel 1–11 var de kända felen i `test/kanda-fel`, som nu är borttagen. Testerna ligger i den vanliga sviten, och före-läget (11 röda tester) finns i git-historiken (commit `8cb6c87`). De som har bokstav eller nummer över 11 hittades på vägen.

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
| 8 | `normalizeUrl` tar bara bort varannan spårningsparameter (borttagning inne i `forEach`), så r01 och r03 dedupliceras inte | H | rättat | `test/normalize-url.spec.ts`: "tar bort alla spårningsparametrar (r01 och r03 är samma kungörelse)", klick-id:n, bevarade parametrar, tom frågesträng, fragment | "Fel 8 – alla spårningsparametrar tas bort ur URL:en" |
| 9 | Tomt alias eller tom domän matchar allt | H | rättat | `test/entity-matcher.spec.ts`: "en entitet utan domän (\"\") matchar inte varje text", tomt alias, blanksteg och "riktiga termer matchar fortfarande …" | "Fel 9 – tomma termer matchar inget" |
| 10 | Svenska böjningar matchar inte (Takvårdarnas), `\b` hanterar inte å, ä och ö, och alias som också är vanliga ord ("Rena Fönster", "Klart Glas", "Tak Team") ger falska träffar | H | rättat | `test/entity-matcher.spec.ts`: "fel 10: alias med genitiv-s matchar (Takvårdarnas)", "å, ä och ö räknas som bokstäver i ordgränserna", "alias matchas skiftlägeskänsligt, så att vanliga ord inte träffar varumärket (r08, r15, r18)" | "Fel 10 – genitiv, Unicode-gränser och skiftlägeskänsliga alias" |
| 11 | Orelaterade texter räknas som samma story: `similarity` antog vektorer med längd 1, men stubbens vektorer har det inte, så skalärprodukten blev godtyckligt stor | H | rättat (bara likheten) | `test/similarity.spec.ts` (9 tester): riktig cosinuslikhet för vektorer av valfri längd, känt värde, symmetri, skalning, nollvektor och icke-tal, olika längd, och "två orelaterade texter räknas inte som samma story (fel 11)" | "Fel 11 – similarity räknar riktig cosinuslikhet (klustring saknas)" |
| 12 | `deny_categories` lästes in men användes aldrig, och artiklarna saknade kategori | K | rättat | `test/access.spec.ts`: "en nekad kategori döljs även för artiklar inom användarens arbetsyta" och "… även akuta artiklar och sökträffar", plus `test/enrich.spec.ts` (kategori ur fast lista, minst en) | "`deny_categories` gäller nu, och kategorin sätts av berikningen" |
| 13 | `renderDigest` kraschar på `summary = null`. Uppstod när fel 5 gjorde sammanfattningen nullbar, inget ärvt fel | M | rättat | `test/raw-text.spec.ts`: "klarar en artikel utan sammanfattning (null) och skriver inte "null"" | "Fel 5 – originaltexten används aldrig som sammanfattning" |
| 14 | Felkodad text vid inläsning: r20 kommer som "FÃ¶nster" (UTF-8 lästa som Latin-1) och ingen kod upptäckte eller reparerade det | H | rättat | `test/ingest.spec.ts`: "repairEncoding" (åtta fall) och "r20: felkodad text repareras, sparas rätt och matchar sin entitet" | "Teckenkodning och tidszoner vid inläsning" |
| 15 | `otherSources` läser `articles` direkt förbi åtkomstmodulen och visar källor utanför omfånget | K | rättat | `test/digest.spec.ts`: "visar aldrig källor från artiklar utanför användarens arbetsyta", "… flaggade för granskning" och "visar inte nekade entiteter eller kategorier som andra källor" | "`otherSources` går via åtkomstmodulen" |
| 16 | `?userId=` i exporten låter vem som helst exportera en annan användares innehåll | K | rättat (autentisering saknas) | `test/export.spec.ts`: "en vanlig användare kan inte exportera en annan användares innehåll" och guard-testerna | "Exporten – `?userId=` bara för admin, och skydd mot CSV-formler" |
| 17 | CSV-export saknar skydd mot formelinjektion (`=`, `+`, `-`, `@`) | H | rättat | `test/export.spec.ts`: "toCsv: skydd mot formelinjektion" | "Exporten – `?userId=` bara för admin, och skydd mot CSV-formler" |
| 18 | Riktig autentisering saknas (`AuthGuard` litar på `x-user-id`), så rollkontrollen i fel 16 kan kringgås. Servern lyssnar därför bara på `127.0.0.1` som standard (se fel 36) | K | kvar | saknas | "Exporten – `?userId=` bara för admin …", under Känd begränsning |
| 19 | `TriageService` släppte igenom allt: `minScore` var 0 och ett fel gav 0 (`0 >= 0`). Använde inte `extractJson`, hade ingen avgränsning mot injektion och accepterade vilka tal som helst. Gav 700 dyra berikningar i stället för 35 | H | rättat | `test/triage.spec.ts` (16 tester: ogiltiga svar släpper inte igenom något, delvis ogiltiga, intervall, kodstaket, omgångar, avgränsning mot injektion), `test/enrich.spec.ts`: "Triage i pipelinen", `test/pipeline-config.spec.ts` | "Triage – ett ogiltigt svar släpper inte igenom något" |
| 20 | Poängformeln (`score.ts`) använder första entiteten i stället för den högst viktade (rättat), saknar faktorn ×0,60 för uppföljning (kvar, se fel 26), och en okänd `watch_level` eller källa ger NaN (rättat) | M | delvis rättat | `test/score.spec.ts`: "använder den högst viktade entiteten, oavsett ordning" och "en okänd bevakningsnivå ger inte NaN". Uppföljningsfaktorn saknar test | "`relevance` räknas ut i berikningen (score.ts kopplas in)" |
| 21 | Trendberäkningen (`trend.service.ts`) räknar rader i `entity_matches` i stället för unika artiklar, så dubbletter och flera alias blåser upp siffran. Använder `created_at` i stället för `published_at` | M | kvar | saknas. Test skrivs när felet tas | – |
| 22 | Entitetsimporten saknar validering ("Hög", tomt namn, EXEMPEL-raden), trimmar inte namn (Rikstak blir dubblett), `merge` skriver över alias, `cast: true` förstör stora `meta_page_id`, och vd-namn (personuppgifter) lagras | H | rättat | `test/entity-import.spec.ts` (11 tester): sju entiteter utan EXEMPEL, tomt namn och dubblett; rapport med radnummer; ihopslagna alias; "Hög" → high med loggad mappning; `meta_page_id` som text; inga vd-namn; inga tomma termer; idempotent; validering av nivå och affärsområde | "Entitetsimporten – validerad, ihopslagen och utan personuppgifter" |
| 23 | Arkitekturtestet söker bara efter textsträngen `from articles`, så `knex('articles')` fångas inte och testet är grönt fast regeln bryts (`DigestService` gjorde det tills fel 15). Ska använda TypeScript-kompilatorn | K | kvar | saknas. Test skrivs när felet tas | – |
| 24 | Tidsstämpel utan tidszon (r21, "2026-09-30 23:30:00") sparades som UTC, eftersom databasen kör `Etc/UTC`. Antagandet är Europe/Stockholm, så tiden blev två timmar fel och kunde hamna på fel dygn. Ogiltigt datum kraschade infogningen | H | rättat | `test/ingest.spec.ts`: "parsePublished" (tid utan zon, med zon, ogiltig), "r21: tid utan tidszon sparas som svensk tid" och "ett ogiltigt datum kraschar inte körningen …" | "Teckenkodning och tidszoner vid inläsning" |
| 25 | `relevance` räknas aldrig ut (`score.ts` anropas inte), så kolumnen är tom och utskicket blir tomt. `entity_ids` sätts aldrig heller | H | rättat (med begränsningar) | `test/enrich.spec.ts`: "relevance räknas ut och sparas, och utskicket blir inte tomt", "källvikten kommer från sources.json …", "färskheten räknas mot den fasta klockan …", "entitetsvikten kommer från den högst viktade matchade entiteten …", "en okänd källa kan inte poängsättas …", plus `test/score.spec.ts` | "`relevance` räknas ut i berikningen (score.ts kopplas in)" |
| 26 | Trend- (×1,25) och uppföljningsfaktorn (×0,60) är inte inkopplade i poängen. Entitetsvikten är missvisande tills fel 9 och 10 är rättade | M | kvar (känd begränsning) | saknas. Test skrivs när felet tas | "`relevance` räknas ut i berikningen (score.ts kopplas in)", under Kända begränsningar |
| 27 | Utskickets tröskel är `>` i stället för `>=`, så en artikel med exakt 55 poäng faller bort (stubbens standardpoäng blev exakt 55) | M | rättat | `test/digest.spec.ts`: "en artikel med exakt tröskelvärdet tas med, och en under den gör det inte" | "Utskicket – tröskel `>=` och sortering före begränsning" |
| 28 | `DigestService` begränsar till 18 artiklar innan den sorterar på brådska, så mer relevanta artiklar kan tränga ut en akut | H | rättat | `test/digest.spec.ts`: "sorterar före begränsningen: en akut artikel med lägre poäng tränger inte ut av mer relevanta" och "inom samma brådska kommer den mest relevanta först" | "Utskicket – tröskel `>=` och sortering före begränsning" |
| 29 | Klustring saknas: `cluster_id` sätts aldrig, så samma story från flera källor skickas som separata nyheter (r16/r17 och r01/r02) och "Även:" i mejlet blir alltid tom. `isSameStory` används ingenstans | H | kvar | saknas. Test skrivs när klustringen byggs | "Fel 11 – similarity räknar riktig cosinuslikhet (klustring saknas)", under Kvarstår |
| 30 | Tröskeln 0,92 för samma story är gissad och inte kalibrerad. Specen kräver kalibrering mot märkt data med under 2 % felaktiga sammanslagningar. Det finns ingen märkt data | H | kvar | saknas. Test (en kalibreringsmätning mot märkt data) skrivs när datan finns | "Fel 11 – similarity räknar riktig cosinuslikhet (klustring saknas)", under Kvarstår |
| 31 | Dubbletter: artiklar var bara unika på `raw_id`, så r01 och r03 (samma kungörelse, olika `utm_`-parametrar) och d01 sparades som separata artiklar och skickades som två nyheter. `normalizeUrl` användes bara för att lagra, inte för att kontrollera | H | rättat | `test/dedupe.spec.ts`: "samma URL (r01 och r03 är samma kungörelse)" (sparas en gång, den första vinner, d01, en gång i utskicket, unik i databasen), och "tracking-parametrar och versaler i värdnamnet gör inte en post unik" | "Dubbletter och idempotens – den normaliserade URL:en är identiteten" |
| 32 | Idempotens (krav 7): en omkörning gjorde nya AI-anrop för redan sparade poster, och `onConflict('raw_id').ignore()` släppte tyst vad som helst som krockade | H | rättat | `test/dedupe.spec.ts`: "samma post körs om" (inga nya artiklar, loggrader eller AI-anrop) | "Dubbletter och idempotens – den normaliserade URL:en är identiteten" |
| 33 | r09 förekommer två gånger med samma id men olika URL och innehåll, och den andra försvann tyst | M | rättat (loggas, sparas inte som artikel) | `test/dedupe.spec.ts`: "samma id men olika innehåll (r09 förekommer två gånger)" | "Dubbletter och idempotens – den normaliserade URL:en är identiteten" |
| 34 | Uppdateringar av en befintlig artikel (d02 uppdaterar r02) tillämpas inte. Posten loggas som `changed_content` men skriver inte över artikeln, och uppföljningsfaktorn finns inte (fel 20) | H | kvar (beslut vid körningen för dag 2) | `test/dedupe.spec.ts`: "samma URL men nytt innehåll (d02 uppdaterar r02)" visar bara att den loggas, inte att den tillämpas | "Dubbletter och idempotens – den normaliserade URL:en är identiteten", under Kvarstår |
| 35 | Rensningen efter 90 dagar finns inte. Specen säger att fulltext "lagras bara för bearbetning och rensas efter 90 dagar". Det gäller `articles.full_text` och `skipped_items.payload` (hela råposter, alltså råtext). Ingenting rensar någon av dem | H | kvar | saknas. Test skrivs när rensningen byggs | "Dubbletter och idempotens – den normaliserade URL:en är identiteten", under Kvarstår |
| 36 | Ingen webbserver: startkoden saknade `main.ts`, så exporten gick inte att anropa | M | rättat | `test/app.spec.ts` (10 tester): appen startar, lyssnar på `127.0.0.1`, 401/200/403/400, admin via `ADMIN_USER_IDS`, roll i anropet räknas inte, CSV-formler neutraliseras, `parsePort`. Verifierat med curl mot `npm start` | "Webbserver och startskript (`main.ts`)" |
| 37 | `knexProvider` fick ingen `DATABASE_URL` utanför skripten och testerna (bara `scripts/db.ts` satte ett standardvärde), så en riktig server fick 500 på varje databasanrop | H | rättat | `test/app.spec.ts` (startar utan `DATABASE_URL`, som `npm start`) och `test/database-config.spec.ts` (3 tester) | "Webbserver och startskript (`main.ts`)" |
| 38 | Testerna och demon delade databas, så `npm test` tömde demodatan (och en felpekad `DATABASE_URL` hade kunnat få testerna att tömma riktig data) | M | rättat | `test/test-database.spec.ts` (6 tester): testerna kör mot `*_test`, `createTestingApp` vägrar en databas som inte slutar på `_test`, `DATABASE_URL` räknas aldrig för testdatabasen. Verifierat manuellt: 21 demoartiklar före och efter `npm test`, och databasen skapas från noll | "Testerna har en egen databas" |

Tabellen listar felen i incidenten, de kända felen och fynden i "Fynd per fil" som har fått en egen rad. Rader utan
test ("saknas") får sitt test först när felet tas, enligt regel 1 i `CLAUDE.md`. Fel 19–38 fortsätter numreringen,
eftersom 13–18 redan används. Inga fel är hittills medvetet bortvalda.

Fynd i "Fynd per fil" som ännu **inte** har en rad i tabellen: att `ContentScopeService` saknar tillåtna listor, nekade källor och högsta brådska,
`onConflict('raw_id').ignore()` i `enrich.service.ts` (rättat i fel 31–33), att
`relevance` aldrig räknas ut (rättat i fel 25), `split(/\W+/)` i stubben och att `knexProvider` inte stänger sin pool.

Bedömd som om den gick i produktion. Allvarlighetsgrad: **K** = kritisk (läcker data eller är ett säkerhetshål),
**H** = hög (ger fel resultat), **M** = medel.
Tester för rättade fel ligger i den vanliga sviten (`test/`). Fel som återstår saknar test tills de tas (regel 1 i `CLAUDE.md`).

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
