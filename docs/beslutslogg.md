# Beslutslogg

Varje post har datum, beslut, alternativ, varför och bevis (testfil). Det som kvarstår efter ett beslut står i statustabellen i `docs/kodgranskning.md` och i `ÖVERLÄMNING.md`.

## De viktigaste besluten

1. Gör den ärvda koden körbar och bevisa felen med tester innan något rättas. [Se posten](#2026-10-09-körbar-kod-först-versioner-och-tester)
2. Incidentens första orsak: akuta nyheter gick förbi arbetsytan, och arbetsytan är en hård gräns även för akuta händelser. [Se posten](#2026-10-09-fel-1-och-2-arbetsytan-är-en-hård-gräns)
3. Incidentens andra orsak: ett AI-svar utan giltig arbetsyta publiceras inte (fail closed). [Se posten](#2026-10-09-fel-4-fail-closed-för-ai-svar-och-kategorier)
4. Incidentens tredje orsak: originaltexten används aldrig som sammanfattning. [Se posten](#2026-10-09-fel-5-originaltexten-är-aldrig-sammanfattning)
5. Inget standardvärde för kategori: ett svar utan kategori är ogiltigt. [Se posten](#2026-10-09-fel-4-fail-closed-för-ai-svar-och-kategorier)
6. En väg in till innehållet via åtkomstmodulen, och arkitekturtestet läser koden med kompilatorn. [Se posten](#2026-10-10-en-väg-in-till-innehållet-och-arkitekturtestet)
7. Profilerna förklarar urvalet men filtrerar det inte. [Se posten](#2026-10-10-profilmatchning-profilerna-förklarar-urvalet-men-filtrerar-det-inte)
8. Klustringen väntar: similarity räknar riktig cosinuslikhet, men inget klustras ännu. [Se posten](#2026-10-09-klustringen-väntar)
9. Trenden räknar bara källor med vikt minst 1,0. [Se posten](#2026-10-10-trenden)
10. Den normaliserade URL:en är artikelns identitet, och inget skickas två gånger (krav 7). [Se posten](#2026-10-09-dubbletter-idempotens-och-körningslogg)

## 2026-10-09: Körbar kod först, versioner och tester
- **Beslut:** Den ärvda koden gjordes körbar oförändrad (Docker, migration, demo) och de 11 kända felen bevisades som röda tester före varje rättning. Därefter flyttades testerna till den vanliga sviten och `test/kanda-fel` togs bort. Senaste paketversioner, utom NestJS 11, TypeScript 6 och `marked` (som togs bort).
- **Alternativ:** Skriva om direkt. Gå över till NestJS 12 och ES-moduler. Behålla en tom `kanda-fel`-mapp med `--passWithNoTests`.
- **Varför:** Felen ska kunna visas och inte bara påstås, och varje rättning bevisas rött till grönt (före-läget finns i commit `8cb6c87`). Versionen av NestJS är ett antagande: varken uppgiften eller den ärvda koden anger någon. Belägg: NestJS 12 släpptes 2026-08-27, strax före uppgiften (kontrollerat med `npm view @nestjs/core time`), så produktionen kör sannolikt inte 12. Därför användes 11, vilket också höll projektet på CommonJS. Antagandet bör stämmas av med företaget.
- **Bevis:** `access.spec.ts`, `enrich.spec.ts`, `render.spec.ts`, `normalize-url.spec.ts`, `entity-matcher.spec.ts`, `similarity.spec.ts`

## 2026-10-09: Fel 1 och 2: arbetsytan är en hård gräns
- **Beslut:** `orWhere` för akuta nyheter är borttagen. Arbetsytan gäller överallt, även akuta händelser (specens avsnitt 2), och mottagarna bestäms alltid av omfånget. Fel 2 (nekade entiteter och sökfilter gällde bara akutgrenen, eftersom AND binder hårdare än OR) försvann med samma ändring men har ett eget test.
- **Alternativ:** En bypass för akuta med rätt roll. Visa akuta men dölj `full_text`. Parenteser runt OR-grenen (hade bevarat bypassen).
- **Varför:** Koden blandade ihop "akuta kan skickas utanför schemat" (när, avsnitt 7) med "utanför behörigheten" (vem). Anna fick en konkursnyhet om takvård.
- **Bevis:** `access.spec.ts`

## 2026-10-09: Fel 3: fulltext lämnar aldrig åtkomstmodulen
- **Beslut:** Explicita kolumner (`PUBLIC_COLUMNS`) i stället för `select('*')`. `sort` är en vitlista (`relevance`, `published_at`, `impact`, `raw_id`, `id`) med standard `relevance desc` och `id` som sekundär sortering. Ogiltigt värde, och allt som inte är text, ger 400.
- **Alternativ:** Ta bort fulltext i varje anropare. Falla tillbaka på standardsortering. Bara parameterbinda (kolumnnamn kan inte bindas).
- **Varför:** `select('*')` var incidentens läcka och `orderByRaw(sort)` var SQL-injektion via exporten. En enda väg in gör att en ny anropare inte kan glömma bort det.
- **Bevis:** `access.spec.ts`

## 2026-10-09: Fel 4: fail closed för AI-svar, och kategorier
- **Beslut:** Standardvärdet för arbetsyta är borttaget. `business_areas` och `categories` valideras mot fasta listor med minst ett värde (kategorier: regler, makro, sasong, konkurrent, eget_varumarke, ovrigt, där de två sista är våra tillägg). Ett ogiltigt svar sparas med `spaces=[]` och `needs_review=true`, åtkomstmodulen filtrerar dessutom på `needs_review=false`, och `deny_categories` gäller nu överallt. Kolumnerna ligger i första migrationen.
- **Alternativ:** Ett standardvärde (även `koncern` eller `ovrigt`). Förbjuda AI:n att ange `koncern`. Härleda kategori ur andra fält. En separat migration.
- **Varför:** Ett osäkert svar får inte tyst bli ett värde som ser riktigt ut (det var läckan), och ett fel får aldrig bredda spridningen. Giltiga men felaktiga svar skyddas inte (känd risk 4b).
- **Bevis:** `enrich.spec.ts`, `access.spec.ts`

## 2026-10-09: Fel 5: originaltexten är aldrig sammanfattning
- **Beslut:** Ett ogiltigt AI-svar ger `summary = null`, och `renderDigest` klarar `null`. Alla vägar för råtext granskades: bara berikningen och rensningen nämner `full_text`, exporten skriver bara `id, title, url, relevance`.
- **Alternativ:** Korta av texten eller ta första meningen. Platshållaren "Sammanfattning saknas". Försöka med en annan modell (AI-routern, bortvald).
- **Varför:** En kort artikel gick ut i sin helhet (incidentens tredje orsak). `null` kan inte förväxlas med en sammanfattning.
- **Bevis:** `enrich.spec.ts`, `raw-text.spec.ts`

## 2026-10-09: Mejlet och utskicket
- **Beslut:** `marked` är borttaget, sammanfattningen är escapad text, och länkar (även `otherSources`) går genom `safeHref` som bara släpper igenom http och https. Urvalet tar relevans `>= 55`, sorterar på brådska och relevans och begränsar till 18 sist. En tom rubrik visas som "(ingen rubrik)" och källans namn (ur `data/sources.json`), i mejlet och i adminvyn.
- **Alternativ:** Behålla `marked` med DOMPurify. Svartlista protokoll. Behålla `>`. En ersättningsrubrik i databasen eller första orden av sammanfattningen.
- **Varför:** Markdown behövs inte och en vitlista tar även nya protokoll. Med `>` föll exakt 55 bort, och `slice` före `sort` kunde trycka ut en akut artikel. En tom länk är osynlig.
- **Bevis:** `render.spec.ts`, `digest.spec.ts`

## 2026-10-10: En väg in till innehållet, och arkitekturtestet
- **Beslut:** All läsning av innehållstabellerna går genom `ArticleAccessService` och en enda `scoped()`. `otherSources` använder `sourcesByCluster`, och läsningarna för dubbletter och trend flyttades in. Arkitekturtestet läser koden med TypeScript-kompilatorn och tillåter bara tre smala skrivundantag i pipelinen, vart och ett med motivering (och uttalade extra villkor, `extraChain`).
- **Alternativ:** Låta utskicket filtrera själv. Behålla regexen. Förbjuda knex utanför `src/access`. Undantag per katalog eller för läsning. Skriva om koden så att detektorn inte ser den.
- **Varför:** Regexen såg inte `knex('articles')`, så `DigestService` och `dedupe.ts` bröt regeln medan testet var grönt. Ett test som går att kringgå skyddar inte.
- **Bevis:** `architecture.spec.ts`, `digest.spec.ts`

## 2026-10-09: Export, server och roller
- **Beslut:** `?userId=` är bara för admin (rollen kommer från `ADMIN_USER_IDS`, aldrig från anropet), annars 403. CSV-celler som börjar med `=`, `+`, `-`, `@`, tabb eller radbrytning får ett inledande `'`. `main.ts` lyssnar bara på `127.0.0.1` (`HOST` och `PORT`), och `DATABASE_URL` krävs i produktion men har en lokal standard utanför.
- **Alternativ:** En roll i en header. Ta bort `?userId=`. Prefixa alla celler. Binda till alla adresser. Kräva `DATABASE_URL` överallt.
- **Varför:** Inloggningen är en platshållare (fel 18), så servern får inte vara nåbar utifrån. En server utan anslutningssträng gav 500 på varje anrop, vilket bara en riktig körning med curl visade.
- **Bevis:** `export.spec.ts`, `app.spec.ts`, `database-config.spec.ts`

## 2026-10-09: Inläsning: teckenkodning, tidszon och adresser
- **Beslut:** Före triage repareras UTF-8 lästa som Latin-1 (r20), tid utan zon tolkas som Europe/Stockholm via `Intl` (r21) och ett ogiltigt datum flaggar artikeln. `normalizeUrl` tar bort alla spårningsparametrar (frågesträngen filtreras som text så att övriga parametrar behåller sin kodning) och avvisar allt utom http och https (`javascript:` blir `invalid_url`). Adminvyn länkar också bara http(s).
- **Alternativ:** Reparera i en CSV-inläsning. `luxon` eller `date-fns-tz`. Anta UTC. Svartlista bara `utm_`. Skriva om alla parametrar via `URLSearchParams`. Filtrera bara i gränssnittet.
- **Varför:** Fel kodning och tid ger fel träffar och fel dygn. Varannan parameter hoppades över (r01/r03), samma adress med och utan spårning fick olika identitet, och en `href` från en extern källa får inte vara `javascript:`.
- **Bevis:** `ingest.spec.ts`, `normalize-url.spec.ts`, `dedupe.spec.ts`

## 2026-10-09: AI-anrop: triage och avgränsad text
- **Beslut:** Triage släpper bara igenom artiklar med en giltig poäng (0 till 100, tröskel 40, gissad, `TRIAGE_MIN_SCORE`). Ett ogiltigt svar ger `unscored`, som inte går vidare. Båda prompterna avgränsar texten med `<artikel>` och samma `neutralize` (upprepad tills inget mer tas bort).
- **Alternativ:** Släppa igenom ogiltiga "för säkerhets skull". Släppa dem tyst. Kasta fel. Kodad text eller slumpad avgränsare (kan komplettera senare).
- **Varför:** `0 >= 0` släppte igenom allt (700 dyra berikningar i stället för cirka 35). En text som kan stänga avgränsningen är injektionsvägen (r19).
- **Bevis:** `triage.spec.ts`, `enrich.spec.ts`, `pipeline-config.spec.ts`

## 2026-10-09: Stubben och AI-leverantör
- **Beslut:** Ingen riktig leverantör är inkopplad. `StubProvider` sätter arbetsyta och påverkan efter nyckelord (tak och rotavdrag ger takvard, fönster och puts ger fonsterputs, Sydkust och börsnotering ger koncern, konkurs ger påverkan 85, annars 50) och triage 50 för allt. Det gäller bara stubben. En leverantör väljs genom att köra kandidater mot ett märkt testset.
- **Alternativ:** Påverkan 50 för alla (platt utskick). Slumpad påverkan (går inte att upprepa). Välja leverantör efter känsla.
- **Varför:** Demon ska vara begriplig och repeterbar, och r06 (rotavdraget) ska nå både takvård och fönsterputs (inga missade regeländringar). Samma märkta data behövs för trösklarna.
- **Bevis:** `enrich.spec.ts`

## 2026-10-09: Entitetsmatchning och import
- **Beslut:** Tomma alias och domäner matchar inget. Ordgränserna är Unicode-medvetna, genitiv-s är tillåtet, alias är skiftlägeskänsliga och domäner inte. Importen avvisar tomt namn, EXEMPEL-rader och okänd nivå, område eller typ (med radnummer), mappar "Hög" till `high` med loggning, slår ihop dubbletter och alias, läser id som text och lagrar inte vd-namn.
- **Alternativ:** Rensa bara i importen. Kasta vid en tom term. Skiftlägeskänsligt bara för vanliga ord (kräver en lista eller flagga). Stamningsbibliotek. Gissa en nivå. Behålla vd-kolumnen tom.
- **Varför:** `\b\b` matchade all text, och "rena fönster" i ett städtips träffade varumärket (vikt 100). Hellre missa ibland än få falska träffar. Personuppgifter som systemet inte behöver lagras inte.
- **Bevis:** `entity-matcher.spec.ts`, `entity-import.spec.ts`

## 2026-10-09: Poängen: relevans, klocka och uppdelning
- **Beslut:** `score.ts` är inkopplad. Relevansen räknas ut vid berikningen med källvikt ur `data/sources.json`, den högst viktade entiteten och en fast klocka (`PIPELINE_NOW`, dag 1 är 2026-10-01 07:00). En okänd källa eller ett ogiltigt datum ger ingen poäng och flaggas. Uppdelningen sparas i `articles.score_breakdown` och räknas aldrig om vid läsning.
- **Alternativ:** En standardvikt för okänd källa. Ett separat jobb efter berikningen. Systemklockan. Räkna om vid läsning. Egna kolumner eller en tabell.
- **Varför:** Ingen räknade ut `relevance`, så utskicket var tomt. En gissad vikt är samma tysta fel som fel 4. Trend och uppföljning kan inte återskapas vid läsning.
- **Bevis:** `score.spec.ts`, `enrich.spec.ts`

## 2026-10-10: Trenden
- **Beslut:** Minst 3 unika artiklar om samma entitet de senaste 30 dygnen på `published_at` (mot körningens klocka, artikeln själv inräknad en gång) ger ×1,25. Bara källor med vikt minst 1,0 räknas (gränsen är gissad), även artikeln själv. Räkningen ligger i `countArticlesAboutEntity`.
- **Alternativ:** Skriva till `entity_matches`. `count(distinct)` där. Räkna om äldre artiklar. Vikta räkningen med källvikt. Utesluta flaggade artiklar.
- **Varför:** Tabellen skrevs aldrig. Forum och Facebook (r05, r19) skapade en trend som höjde ryktet r19 till 99 (nu 79). Verifiering mot en andra källa är den riktiga lösningen (bortvald).
- **Bevis:** `trend.spec.ts`

## 2026-10-09: Klustringen väntar
- **Beslut:** `similarity` räknar riktig cosinuslikhet (begränsad till [-1, 1], nollvektor och icke-tal ger 0, olika längd kastar `RangeError`). Klustring byggs inte, och tröskeln 0,92 är gissad.
- **Alternativ:** Normalisera vid `embed`. Låta olika längd ge 0.
- **Varför:** Antagandet om längd 1 gjorde orelaterade texter till "samma story". Specen kräver kalibrering mot märkt data (under 2 % felaktiga sammanslagningar), den saknas, och stubben kan inte bedöma betydelse.
- **Bevis:** `similarity.spec.ts`

## 2026-10-09: Dubbletter, idempotens och körningslogg
- **Beslut:** Den normaliserade URL:en är identiteten (`articles.url` är unik), kontrollen sker före triage och berikning med en innehållshash, och `raw_id` förblir unikt. Poster blir ny, redan sparad, `duplicate`, `changed_content`, `raw_id_collision` eller `invalid_url`, och loggas med hela råposten i `skipped_items`. Varje steg (inläsning, berikning, profilmatchning) loggar i `pipeline_runs` med `running` vid start och antal i `details`.
- **Alternativ:** Bara `ON CONFLICT DO NOTHING`. Ett nytt id åt andra r09. Senaste posten vinner. Göra `raw_id` icke-unikt (öppet val). Egna kolumner för antalen.
- **Varför:** `raw_id` är opålitligt (r09 två gånger), en omkörning gjorde nya AI-anrop, och krav 7 kräver idempotens och en körningslogg där en död process syns.
- **Bevis:** `dedupe.spec.ts`, `pipeline-runs.spec.ts`

## 2026-10-10: Dag 2: uppdateringar, rättelser och utskickslogg
- **Beslut:** En uppdatering (samma URL, ny text) tillämpas bara om den är nyare än den sparade versionen. Artikeln behåller sitt id, berikas om, markeras som uppföljning och får ×0,60 bara om den redan skickats. Rättelser (första ordet "Rättelse" eller "Korrigering", avgjort av en regel) förbigår tröskel och antal men inte omfång eller loggen. Utskicksloggen ligger i `editions`, `deliveries` och `delivery_items` (förvald publikation tills publikationer byggs), och `send` loggar medan `compose` inget sparar.
- **Alternativ:** Tillämpa varje ändring. Spara uppdateringen som ny artikel. Ersätta med en flaggad artikel. ×0,60 alltid. Låta AI:n avgöra rättelser. Låta rättelser förbigå loggen. En egen tabell `sent_articles` eller en jsonb-lista.
- **Varför:** Annars byter en omkörning fram och tillbaka, dag 2 upprepar dag 1, och en missad rättelse av en regeländring är dyr. `delivery_items` ger uppslag och främmande nycklar i SQL.
- **Bevis:** `updates.spec.ts`, `delivery.spec.ts`, `day2.spec.ts`, `correction.spec.ts`

## 2026-10-10: Datamodellen och innehållsomfånget
- **Beslut:** Hela datamodellen (krav 2, med behörighet) ligger i den första migrationen, som redigerades och inte fick någon efterföljare. `content_scopes` styr omfånget med arbetsyta, tillåtna och nekade kategorier, källor och entiteter, och högsta brådska. Tom tillåtelselista betyder ingen begränsning, nekat vinner (allt med AND) och en okänd brådska är ett fel.
- **Alternativ:** En andra migration. Flytta till `memberships` direkt. En `CHECK` på `max_urgency`. Tom lista som "inget tillåtet". Akuta förbi `max_urgency`.
- **Varför:** Specen säger "från första migrationen" och ingen produktionsdata finns att bevara. En `OR` kan släppa in något igen (fel 1 och 2).
- **Bevis:** `access.spec.ts`, `schema.spec.ts`

## 2026-10-10: Frågespråket
- **Beslut:** Egen tokenizer och rekursiv parser utan reguljära uttryck, med fel som har position (`pf-tak-pris`, `pf-puts`). Operatorer skrivs med versaler, termer matchar hela ord, `*` står bara sist och `NEAR/n` betyder högst n ord. Fält som artiklarna saknar data för (`author`, `region`, `lang`) ger ett syntaxfel (`PROFILE_FIELDS`), och ett test fäller bygget om `src/query` innehåller en regex.
- **Alternativ:** Ett parserbibliotek eller en regex-tokenizer. En Pratt-parser. En trasig profil som tom profil. Ta bort fälten ur språket. Kontrollera trädet efteråt.
- **Varför:** Krav 4. En profil som tyst matchar ingenting (eller allt, med `NOT`) är samma fel som fel 4.
- **Bevis:** `query-tokenizer.spec.ts`, `query-parser.spec.ts`, `query-evaluator.spec.ts`, `query-no-regex.spec.ts`

## 2026-10-10: Profilmatchning: profilerna förklarar urvalet men filtrerar det inte
- **Beslut:** Efter berikningen matchas varje profils senaste version i batch mot de nya artiklarna, inom ägarens omfång, och träffarna sparas idempotent i `profile_matches` (poäng 1). Trasiga profiler hoppas över och behåller sin senaste giltiga version. Mejlet visar "Varför: profil (term)" för egna profiler, och urvalet styrs inte av profilerna. Berikningen sätter nu `source_name`.
- **Alternativ:** Matcha vid läsning. En trasig profil som tom. Läsa `articles` direkt. Filtrera utskicket på profilträff. En åtkomstmetod som lämnar ut fulltext.
- **Varför:** Krav 3. Med filtrering hade Kalle missat rotavdraget (r06), och specens mål är inga missade regeländringar. Filtrering hör till publikationer och sektioner.
- **Bevis:** `profile-matching.spec.ts`, `profile-digest.spec.ts`

## 2026-10-10: Rensning efter 90 dagar
- **Beslut:** `npm run purge` nollar `articles.full_text` och sätter `skipped_items.payload` till `{}` för det som är äldre än 90 dagar (strikt), mot pipelinens klocka. Åldern är `COALESCE(GREATEST(published_at, updated_at), created_at)` och pipelinen sätter `created_at` från klockan. Det körs i en transaktion och loggas som steget `purge`.
- **Alternativ:** Köra rensningen i `PipelineService.run`. Radera hela raden i `skipped_items`. `created_at` för alla. Låta artiklar utan datum behålla texten (första versionen, ändrad).
- **Varför:** Specen: fulltext rensas efter 90 dagar. Vid osäker ålder sparas mindre, inte mer (fail closed), och `{}` är en idempotent markör som låter loggen finnas kvar. Arkitekturundantaget är uttalat och inte dolt i en callback.
- **Bevis:** `purge.spec.ts`, `architecture.spec.ts`

## 2026-10-10: Testerna: egen databas, tyst logg och färre dubbletter
- **Beslut:** Testerna kör mot `bevakning_test` (skapas av `globalSetup`, vägrar namn utan `_test`, och `DATABASE_URL` räknas aldrig). Nests logg är tyst i testerna och varningar kontrolleras via `Logger.prototype.warn`. Två översyner tog bort dubbletter (481 till 464) och gav regel 8: ett test per beteende, `test.each` för varianter, inga trivialiteter, och säkerhetstesterna orörda.
- **Alternativ:** Ett annat schema eller en egen container. Rollback per test. Tysta loggen utan att kontrollera den. Färre men större tester.
- **Varför:** `npm test` raderade demodatan och kunde tömma fel databas. En varning som inte testas kan tas bort obemärkt. Sviten ska gå att överblicka utan att täckningen minskar.
- **Bevis:** `test-database.spec.ts`, `triage.spec.ts`

## 2026-10-10: Adminverktyget är läs-bart
- **Beslut:** `GET /admin/users`, `/admin/view-as/:userId` och `/admin/users/:userId/profiles` samt ett gränssnitt i `frontend/`, bakom `AuthGuard` och `AdminGuard`. Artiklarna går via `forUser` med användarens omfång och en uttrycklig fältlista. Profilvyn visar status, version, träffade artiklar (raw_id) och vad en `NOT` uteslöt, och läser trasiga profiler ur profilfilen med samma `checkProfile`. Poängens uppdelning visas. Ingen användarhantering.
- **Alternativ:** Läsa namn ur `users`. `?userId=` på en befintlig väg. Ett eget adminomfång. Spara överhoppade profiler eller `NOT`-uteslutningar i en tabell.
- **Varför:** Specen kräver "visa som annan användare" och en förklaring per artikel. Inloggningen är en platshållare, så ett skrivande verktyg vore en ny säkerhetsrisk. Trasiga profiler sparas inte och syntes annars bara i loggen.
- **Bevis:** `admin.spec.ts`, `admin-profiles.spec.ts`

## 2026-10-10: Frågetestaren
- **Beslut:** `POST /admin/query-test` (bara admin) söker i hela arkivet (ej flaggade) via `matchWholeArchive`, som matchar mot originaltexten inne i åtkomstmodulen (rubrik och sammanfattning när texten är rensad, märkt med `textSource`) och aldrig lämnar ut den. Varje träff märks `visibleToUser` av samma `scoped()`, `explainHidden` förklarar bara orsaken, och ett syntaxfel ger 200 med position.
- **Alternativ:** Bara rubrik och sammanfattning (första versionen, ändrad: gav andra träffar än pipelinen). Söka i användarens omfång. `search_vector`. Spara träffarna. Spara träffande ord per artikel.
- **Varför:** Specen: vad hade profilen fångat i arkivet. Ett verktyg som svarar annorlunda än profilen missvisar. Originaltext får bearbetas men inte visas (uttalat undantag i `raw-text.spec.ts`).
- **Bevis:** `admin-query.spec.ts`, `raw-text.spec.ts`

## 2026-10-10: Demon tömmer bara den lokala demodatabasen
- **Beslut:** `assertDemoDatabase` körs först i demon och vägrar allt utom databasen `bevakning`, och alltid i produktion (och testdatabasen).
- **Alternativ:** Kräva en flagga (`--yes`). Lägga skyddet i `db()` (testerna hade behövt ett undantag). Bara dokumentera.
- **Varför:** `npm run demo` kör `TRUNCATE … CASCADE` mot vilken `DATABASE_URL` som helst. Testerna hade ett skydd sedan fel 38, demon inte.
- **Bevis:** `database-config.spec.ts`

## 2026-10-10: Mindre rättningar från kodgranskningen
- **Beslut:** Bara `NotFoundException` hoppar över en profil vid inläsning (ett databasfel stoppar körningen). `sort` som inte är text ger 400. Adminvyns `QueryTester` nollställs vid användarbyte. `@radix-ui/react-slot` är borttaget. Regel 5 i `CLAUDE.md` följer uppgiften: inga personuppgifter i beslutsloggen eller överlämningen, och git-historiken skrivs inte om.
- **Alternativ:** Skriva om historiken (en ingripande ändring mot ett krav som inte finns). Lämna `catch {}` som det var.
- **Varför:** Ett databasavbrott såg ut som att alla ägare saknades, och ett resultat fick visas under fel användares namn. Uppgiften säger att koden hanteras utan git-historik.
- **Bevis:** `profile-matching.spec.ts`, `access.spec.ts`

## 2026-10-13: AppModule delad i en modul per område

- **Läge:** Allt låg i en enda `AppModule` (kodskuld i överlämningen). Nests konvention är en modul per område med tydliga exporter.
- **Alternativ:** (a) Behålla en modul och dokumentera. (b) Dela upp och flytta även `purge` och `profile-match` ut ur `pipeline/`. (c) Dela upp men låta dem ligga kvar.
- **Beslut:** (c). Moduler: `AppConfigModule` och `DatabaseModule` (globala), `LlmModule`, `AccessModule`, `RunsModule`, `ProfilesModule`, `PipelineModule`, `ImportModule`, `DigestModule`, `AdminModule`. `RunLogService` flyttades till `src/runs/` eftersom både profiler och pipeline använder den (annars hade modulerna fått en cirkel). `ExportController` och `csv.ts` flyttades från `admin/` till `src/export/` med egen `ExportModule`, eftersom exporten är för inloggade användare och inte admin. Ingen logik ändrad.
- **Varför (b) valdes bort:** Arkitekturtestet kräver att skrivundantagen ligger under `src/pipeline/`. Att flytta filerna hade krävt en försvagad assertion i säkerhetstestet. Rensning och profilmatchning är dessutom pipelinesteg.
- **Verifiering:** `npm run typecheck`, `npm test` (608 gröna, oförändrat antal) och `npm run demo`.

### Tillägg samma dag: konfigurationen samlad på ett ställe

- **Läge:** Miljövariablerna lästes på flera ställen (`main.ts`, `auth.guard.ts`, `clock.ts`, `pipeline.config.ts`, `database.ts`), utan samlad kontroll vid start.
- **Alternativ:** (a) Låta det vara och dokumentera. (b) En fil, `src/config/configuration.ts`, med `ConfigModule.forRoot({ load, validate })` och NestJS standard `ConfigService`. (c) Som (b) men med en egen klass (`AppSettings`) som läser om miljön vid varje anrop.
- **Beslut:** (b). Först valde jag (c), eftersom `ConfigService` cachar konfigurationen när appen skapas och sex testställen sätter `ADMIN_USER_IDS` efteråt. Det avvek från standard, så testerna ändrades i stället: de sätter nu miljövariabeln före `createTestingApp()` och `bootstrap()` (`app.spec`, `admin.spec`, `admin-query.spec` i två block, `admin-profiles.spec` var redan rätt), och `export.spec` och `database-config.spec` skapar sin `ConfigService` efter att miljön är satt. Ingen assertion ändrades. `AppSettings` är borttagen.
- **Så fungerar det:** `loadConfiguration` returnerar ett typat objekt. `AuthGuard`, databasen, klockan och `main.ts` läser det via `ConfigService<AppConfiguration, true>`. `pipelineConfig` (för rena funktioner som inte injiceras, till exempel `similarity.ts`) bygger på `loadPipelineConfig` i samma fil. `validateEnv` körs vid start och stoppar vid ogiltigt `PIPELINE_NOW` (förut blev klockan tyst ett ogiltigt datum) eller saknad `DATABASE_URL` i produktion. Rött först: `test/configuration.spec.ts` och `test/env-validation.spec.ts`.
- **Varför `pipelineConfig` inte är injicerad:** den används som konstant av rena funktioner (`similarity.ts`) och av ett tiotal tester. Att göra den injicerad är en stor ändring för liten vinst. Ogiltiga `PORT`, `TRIAGE_MIN_SCORE` och `DEDUPE_THRESHOLD` ger fortfarande standardvärdet, som förut.
- **Följd:** Konfigurationen läses när appen skapas, så en miljövariabel måste vara satt före start. Det gäller också testerna.
- **Kvar utanför:** `resolveDatabaseUrl` har `process.env` som standardargument (anropas bara från `configuration.ts` och skripten). Datafilerna (`sources.ts`, `users.ts`) läser data och inte inställningar.
- **Version:** `@nestjs/config` 4.0.4. Version 12 (senaste) är bara ES-modul och fungerade inte med CommonJS och ts-jest (23 sviter föll). Kontrollerat med `npm view` före installation.
- **Verifiering:** 624 tester gröna, `npm run demo`, `npm run purge` och HTTP-prov (401, 403, 200, och 403 för Mikael utan `ADMIN_USER_IDS`). Ogiltigt `PIPELINE_NOW` och saknad `DATABASE_URL` i produktion stoppar starten.

#### Rättningar efter kodgranskning (`/code-review`), samma dag

Granskningen hittade nio saker. Jag kontrollerade fyra mot koden, och alla stämde. De är rättade, med rött test först:

1. **`HOST=` (tom) öppnade servern mot alla gränssnitt.** `env.HOST ?? DEFAULT_HOST` släppte igenom en tom sträng, och Node binder en tom host till `::`. Autentiseringen är en platshållare som litar på headern, så det var det allvarligaste. Nu `env.HOST?.trim() || DEFAULT_HOST`. Test: `configuration.spec.ts` (tom och blank `HOST`).
2. **Överlämningen pekade på en rad som inte fanns** (`{ provide: CLOCK, useValue: fixedClock() }`), eftersom jag själv hade bytt den mot en `useFactory`. Följer man instruktionen i produktion kan man behålla den fasta klockan. Det var mitt fel och granskningen fångade det. Raden beskriver nu den riktiga posten och vilka importer som blir oanvända.
3. **`pipeline` i `loadConfiguration` var död kod** och en andra väg till samma värden. Fältet är borttaget. Trösklarna nås bara via `pipelineConfig`.
4. **`pipelineConfig` lästes vid import**, före en eventuell `.env`. Den är nu lat: den läser miljön vid första användningen (och cachar då). Test: `pipeline-config.spec.ts` (värdet sätts efter importen).

**Inte åtgärdat, noterat som kodskuld i `ÖVERLÄMNING.md`:** `fixedClock()` läser inte längre `PIPELINE_NOW` själv (bara DI-vägen gör det), ett `PIPELINE_NOW` utan tidszon tolkas i serverns tidszon och inte som Europe/Stockholm (var så före ändringen också), `validateEnv` körs vid import av `app.module.ts` och inte vid start, `AuthGuard` kräver `ConfigService` och adminlistan fryses vid start (priset för standardmönstret), och `main.ts` re-exporterar `DEFAULT_HOST`, `DEFAULT_PORT` och `parsePort` för bakåtkompatibilitet.

**Verifiering:** 629 tester gröna, `npm run demo`, `npm run purge` och HTTP-prov med `HOST=` tom (binder 127.0.0.1).

## AI-logg

- **2026-10-09, AI hjälpte (`otherSources`-läckan):** AI:n läste utskicksmodulen och hittade att `otherSources` frågade `articles` direkt, förbi åtkomstmodulen. Namn och länkar till källor från artiklar utanför omfånget, flaggade för granskning och i nekade kategorier, kunde alltså nå fel mottagare. Arkitekturtestet missade det eftersom det bara söker efter `from articles`. AI:n skrev först tre röda tester och sedan `sourcesByCluster`, som delar omfångsregler med resten av åtkomstmodulen. Jag granskade lösningen och valde den framför att låta utskicket filtrera själv. Läckan hade inte upptäckts av de ärvda testerna.
- **2026-10-09, AI hjälpte (`relevance` och `entity_ids` sattes aldrig):** AI:n spårade varför utskicket blev tomt. `DigestService` filtrerar på `relevance`, men ingen kod räknade ut den (`score.ts` anropades aldrig), och `entity_ids` sattes inte heller, så `deny_entities` kunde inte träffa något. Det var två tysta fel som såg ut som fungerande kod. Jag fattade besluten om hur en okänd källa ska behandlas (ingen poäng och flaggad, inte en gissad vikt), och AI:n byggde det med tester.
- **2026-10-09, AI hjälpte (omkörningen gjorde onödiga AI-anrop):** Vid genomgången av idempotens (krav 7) visade AI:n att en omkörning gjorde nya AI-anrop för poster som redan var sparade, och att `onConflict('raw_id').ignore()` tyst släppte allt som krockade, till exempel den andra r09. Förslaget var att kontrollera dubbletter före triage och berikning, med den normaliserade URL:en som identitet och en `skipped_items`-tabell med hela råposten. Jag valde att inte ge den andra r09 ett nytt id. Testet "samma post körs om" räknar AI-anropen.
- **2026-10-09, AI hade fel:** AI-verktyget skrev `package.json` med versioner ur minnet, och flera låg en till två huvudversioner efter. Upptäcktes vid installationen, och versionerna kontrollerades med `npm outdated`. Lärdom: kontrollera alltid versioner mot registret, lita inte på AI:ns minne.
- **2026-10-09, jag avvisade AI:ns förslag:** AI:n föreslog att `ovrigt` skulle bli standardkategori när modellen inte anger någon. Jag avvisade det, eftersom det upprepar mönstret i fel 4 (ett tyst standardvärde som ser ut som ett riktigt beslut). Artikeln skulle dessutom hamna i en kategori som ingen valt, och `deny_categories` skulle behandla den som det. Rätt beteende är att ett svar utan kategori är ogiltigt. Lärdom: AI:n föreslår gärna en mjuk standard för att slippa fel. Granska varje förslag om "standardvärde" mot fel 4.
- **2026-10-10, AI hade fel (omskrivning för att passera ett test):** När arkitekturtestet underkände rensningen flyttade AI:n villkoren in i en `where`-callback, där detektorn inte tittar, och kallade det en rättning. Det var en anpassning till kontrollen och inte en förbättring av koden. Användaren ifrågasatte det. Callbacken ersattes av ett uttalat, motiverat undantag i testet (`extraChain`), med tester som visar att det inte öppnar för läsning. AI:n hade också låtit artiklar utan datum behålla fulltexten för alltid, vilket strider mot fail closed. Lärdom: när ett säkerhetstest underkänner koden, ändra regeln öppet eller ändra beteendet. Skriv inte om koden tills testet slutar se den.
