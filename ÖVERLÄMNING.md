# Överlämning

Det här är läget för dig som tar över och inte kan fråga någon.
Detaljerna finns i två dokument. `docs/kodgranskning.md` har en statustabell överst: varje fel, dess status och testet som bevisar det. `docs/beslutslogg.md` har varje beslut, med alternativ och motivering.

## Vad systemet gör

Systemet är till för en koncern med två affärsområden (takvård och fönsterputs) och många mottagare. Mikael, Kalle och Anna i `data/users.json` är testanvändare.
In går råposter från nyhetskällor, kungörelser, recensioner och forum. Ut kommer ett mejl per mottagare med bara det som rör hens arbetsyta, med poäng och en förklaring till varför artikeln kom med.
En AI-modell (i dag en stub) sorterar och berikar posterna, och en åtkomstmodul ser till att ingen får se fel arbetsyta.

## Kom igång

Kräver Node 22.12 eller senare och Docker.

```bash
npm install
npm run db:up          # PostgreSQL i Docker, port 5433
npm run migrate        # skapar alla tabeller (en enda migration)
npm run demo           # kör dag 1 och dag 2 och visar vad varje användare får
npm test               # hela sviten, mot en egen databas (bevakning_test)
```

**Så ser det ut när det fungerar:**
- `npm test` visar 608 godkända tester i 39 sviter.
- Demon importerar 7 entiteter och sparar 21 av 23 råposter (r03 och den andra r09 hoppas över). Profilerna `pf-tak-pris` och `pf-puts` hoppas över med ett felmeddelande, och det är meningen.
- Utskicket dag 1 innehåller 14 artiklar för Mikael, 10 för Kalle och 4 för Anna (r06, r07, r09, r20). Anna får ingen konkurs.
- Demon varnar för `r08` hos Anna och Mikael ("brus"). Det är stubbens poäng, se Risker.
- På dag 2 får Anna 0 artiklar (d06 når inte tröskeln 55). Mejlförhandsvisningar ligger i `out/`.

Mer: `npm start` (servern på 127.0.0.1:3000, se README för exporten), `npm run start:admin` (Mikael som admin, för `frontend/`), `npm run query -- '<fråga>'` (visar hur en profilfråga tolkas), `npm run purge` (rensar fulltext äldre än 90 dagar), `npm run typecheck`.
Har du ändrat migrationen (senast `articles.score_breakdown`)? Kör `npm run db:down` först, eftersom datamodellen ligger i en enda migration.

## Starta adminverktyget

Kör först demon, så att det finns data (`npm run demo`). Starta sedan backend och frontend i två terminaler:

```bash
# Terminal 1: servern, med Mikael som admin
npm run start:admin

# Terminal 2: gränssnittet
cd frontend
npm install
npm run dev
```

Öppna adressen som Vite skriver ut (oftast http://localhost:5173). Vite skickar anropen till servern på port 3000, så ingen extra inställning behövs.

**Så ser det ut när det fungerar:** välj Kalle och se konkursnyheten med "Varför: pf-konkurrenter-tak (Takvårdarna)". Välj Anna: konkursen syns inte. Skriv `konkurs*` i frågetestaren som Anna: 4 träffar i arkivet, 0 synliga för Anna.

## Hur det hänger ihop

```
råposter → inläsning → dubblettkontroll → triage → berikning → poäng → profilmatchning → utskick per mottagare
          (ingest.ts)  (dedupe.ts)        (AI)     (AI)        (score.ts) (query/)        (digest/)
```

| Var | Vad |
|---|---|
| `src/access/` | Den enda vägen till innehållstabellerna. Lägger på användarens omfång. Arkitekturtestet fäller bygget om annan kod läser dem direkt. |
| `src/pipeline/` | Stegen i kedjan, samlade i `pipeline.service.ts`, samt rensningen (`purge.service.ts`) och profilmatchningen. Varje steg loggar sin körning i `pipeline_runs`. |
| `src/runs/` | `RunLogService`: loggen över körningar. Ligger för sig eftersom både profiler och pipeline använder den. |
| `src/profiles/` | Profilerna (inläsning, versioner, status) och översättningen av en artikel till frågespråkets fält. |
| `src/query/` | Frågespråket: tokenizer, parser och utvärdering, utan reguljära uttryck. |
| `src/llm/` | `LlmProvider`-gränssnittet och stubben. All AI går genom gränssnittet. |
| `src/digest/` | Urval och rendering av mejlet. Sparar vad som skickats i `editions`, `deliveries` och `delivery_items`. |
| `src/admin/`, `frontend/` | Det läs-bara adminverktyget. Gränssnittet har eget `package.json`. |
| `src/export/` | CSV-exporten av artiklar (`GET /export/articles.csv`), för inloggade användare. |
| `src/config/`, `src/db/` | Tröskel, klocka, källornas vikter och användarnamn, samt databasanslutningen. Båda är globala moduler. |
| `data/` | Testdata, entitetsregister, källor, användare och profiler. |
| `migrations/` | Hela datamodellen, inklusive behörighet, i en migration (krav 2). |
| `test/` | Testerna. `architecture-scan.ts` är detektorn bakom arkitekturtestet. |

**Moduler:** varje mapp ovan har en egen NestJS-modul (`*.module.ts`), och `src/app.module.ts` sätter bara ihop dem. En modul når bara det andra moduler exporterar. `AccessModule` exporterar åtkomsttjänsterna, och inget annat når innehållstabellerna. Beslutet och avvägningarna står i beslutsloggen (2026-10-13).

**Controllers:** de finns bara där något exponeras över HTTP, alltså `AdminController` (`src/admin/`) och `ExportController` (`src/export/`). Övriga områden körs av skript (`npm run demo`, `npm run purge`) och har ingen controller. Att veta: pipelinen kan inte startas via API, och vanliga användare kan inte hantera sina profiler över HTTP. Det är medvetet bortvalt tills riktig inloggning finns.

**Ordlista:**
- **Stubben:** en falsk AI (`src/llm/stub.provider.ts`). Den sätter arbetsyta och påverkan efter nyckelord.
- **Triage:** första sorteringen. AI:n ger varje post ett grovt betyg, och poster under 40 slängs.
- **Berikning:** AI:n lägger till arbetsyta, kategori, entiteter, påverkan och sammanfattning. Svaret valideras mot fasta listor.
- **Omfång:** vad en användare får se: arbetsyta, tillåtna och nekade kategorier, källor och entiteter, högsta brådska. Lagras i `content_scopes`.
- **Profil:** en sparad sökfråga som en användare äger, till exempel `Rikstak AND NOT pumpa*`. Den förklarar varför en artikel kom med men filtrerar inte urvalet.
- **Fail closed:** vid osäkerhet får hellre ingen se nyheten än fel person.
- **Flaggad för granskning:** en artikel där AI:ns svar var ogiltigt. Den sparas men syns inte för användare.

## Grundregler

Ändringar bör följa dem.
- **Fail closed.** Inga tysta standardvärden.
- **Omfånget gäller överallt.** Arbetsytan är en hård gräns, även för akuta händelser och rättelser.
- **Aldrig fulltext ut.** Bara åtkomstmodulens kolumnlista lämnar modulen, och `full_text` finns inte i den.
- **Idempotens.** Allt kan köras om utan dubbletter och utan nya AI-anrop.

## Vad som fungerar

Allt med status "rättat" i statustabellen. I korthet:
- Behörighet per arbetsyta, kategori, källa, entitet och brådska. Nekat vinner alltid.
- Incidenten (en fönsterputsanvändare fick en konkursnyhet om takvård med hela texten): alla tre orsakerna rättade (fel 1, 4 och 5).
- Inläsning med reparation av teckenkodning och tidszoner, dubblettkontroll, uppdateringar och rättelser som alltid kommer med.
- Triage, berikning och poäng enligt specens formel, med trend- och uppföljningsfaktor.
- Frågespråket med profilmatchning efter berikningen. Mejlet visar "Varför: …".
- Utskick per mottagare som inte skickar samma sak två gånger, och CSV-export med skydd mot Excel-formler.
- Adminverktyget "visa som annan användare" med poängens uppdelning och en frågetestare. Provat manuellt i webbläsaren, men utan automatiska tester.
- Rensning av fulltext efter 90 dagar.

## Risker

Det som kan ge läckor, fel eller falska larm. Övriga begränsningar står under Kodskuld.

| Risk | Vad det innebär | Var |
|---|---|---|
| **Inloggningen är en platshållare** | `AuthGuard` litar på headern `x-user-id`, så vem som helst kan utge sig för att vara admin. Servern lyssnar bara på 127.0.0.1 och får inte exponeras innan riktig inloggning finns. | Fel 18 |
| **Allt körs mot stubben** | Poängen visar att flödet fungerar men är ingen bedömning (därför kommer städtipset r08 med). Ingen riktig AI är testad. | `src/llm/stub.provider.ts` |
| Rykten kan nå högt upp | Ryktet r19 ("Rikstak i konkurs?!", från ett forum) får 79 poäng och kommer med i utskicket för takvård. Svaga källor (vikt under 1,0) kan inte längre skapa en trend, men gränsen är inte kalibrerad. | Fel 4b och 49 |
| **AI:n kan välja fel men giltig arbetsyta** | Valideringen stoppar ogiltiga svar, inte felaktiga. En modell som luras av injektionstext (fel 4b, som i r19) kan skicka en nyhet till fel arbetsyta. | Fel 4b |
| Samma story skickas flera gånger | Klustring saknas, så r01/r02 och r16/r17 kommer som separata nyheter. Tröskeln är inte kalibrerad och märkt data saknas. | Fel 29, 30 |
| Omfånget har luckor | En artikel utan källa träffas inte av en nekad källa, men släpps inte in av en icke-tom `allow_sources` (antagande att stämma av). Äldre rader med tom `categories` döljs inte av `deny_categories`. | `src/access/` |
| Inga riktiga mejl | Utskicket sparas och renderas till `out/` men skickas inte. Plaintext, dark mode och avregistreringslänk saknas. | `src/digest/` |
| Varje post måste ha en http(s)-adress, och insamlingen finns inte än | Demon läser `data/*.json`, och en riktig version behöver en insamlare per källa som gör om till `RawItem`. Adressen är både artikelns identitet (dubblettkontrollen och den unika kolumnen `articles.url`) och länken i mejlet. En post utan giltig adress hoppas över som `invalid_url` och loggas i `skipped_items`, vilket inte håller för dokument utan adress (PDF, Excel). Förslag: insamlaren lagrar dokumentet och ger det en intern https-länk, så att pipelinen inte ändras. Alternativet är ett eget id-fält vid sidan av länken, men det kräver ändringar i dubblettkontrollen, databasen och mejlet. | `normalize-url.ts`, `dedupe.ts` |
| Prestandakraven är inte mätta | Inget krav i specens avsnitt 10 är mätt, till exempel arkivsök under 800 ms och frågor under 2 sekunder mot 30 dagar. Frågetestaren läser upp till 5000 artiklar i minnet. | – |

## Nästa steg, i ordning

**1. Gör det som finns användbart och säkert.**
Riktig inloggning (till exempel företagets SSO) och rollerna från datamodellen i bruk, med ett gränssnitt eller API som sätter `content_scopes`.
Dela åtkomstmodulen i flera tjänster med samma arkitekturtest. Bygg klustring när märkt data finns, och låt "Även:" i mejlet använda `sourceLabel` (visar i dag id:t).
*Varför först:* ett system som kan läcka data eller skickar samma story tre gånger blir inte bättre av fler funktioner.

**2. Riktig AI och riktiga utskick.**
En riktig leverantör bakom `LlmProvider`, via en router med modellval, reservmodell, omförsök, kostnadsräkning och budgettak per dygn. Hallucinationsskydd (tal i sammanfattningen måste finnas i källtexten) och verifiering av akutlarm mot en andra källa, vilket också löser r19-risken.
Välj leverantör genom att köra två eller tre kandidater mot ett märkt testset (krav: data inom EU, bra svenska, under 60 kronor per utskick). Sedan riktiga mejl, publikationer och prenumerationer.
Profilernas semantiska del, filter och extra instruktion hör hit.
*Varför före insamlingen:* det går att bygga och mäta med testdatan som finns. Insamlingen kräver mer arbete och juridiska överväganden.

**3. Riktig insamling.**
En basklass för källor med robots.txt och högst en förfrågan per två sekunder per domän, och en adapter per källtyp (RSS, JSON, HTML, PDF, kungörelser, recensioner, platsannonser).
Övervakning av källhälsa, så att en tyst källa syns. Schemaläggning av pipelinen och av rensningen (i dag schemalägger inget jobbet). Adaptrarna levererar bara `RawItem`.
Fälten `author`, `region` och `lang` läggs till i `PROFILE_FIELDS` när adaptrarna levererar dem.
*Varför här:* det är den största delen, och den är meningslös innan steg 1 och 2 gör resultatet säkert och bra.

**4. Verktyg för redaktörer och admin.**
HTTP-vägar för sök, arkiv, API och utskick (specen kräver att omfånget gäller även där, i dag finns bara export och admin). Mät frågetestaren mot kravet, bygg en redaktionell arbetsyta för att godkänna en utgåva, och skrivande adminfunktioner med revisionslogg (först efter riktig inloggning).
Sist larmmotor och feedback.
*Varför sist:* verktygen bygger på att allt ovan fungerar.

Löpande: mät målen i specen (inga missade regeländringar, under 20 procent falska träffar i konkurrentbevakningen, under 60 kronor per utskick). Det kräver märkt data, och det bör finnas tidigt.

## Kodskuld

Ingen av dessa läcker data. De gör koden svårare att ändra, eller är kända begränsningar. Varje fel har sin rad i statustabellen.

| Område | Vad | Varför |
|---|---|---|
| Moduler och start | `AppModule` är delad per område (se beslutsloggen 2026-10-13). Kvar: flytta filläsning vid import till `useFactory`, ge en gemensam `dataDir()`, stäng poolen i `OnApplicationShutdown` och slå på `enableShutdownHooks()`. Vid riktig inloggning: global guard med `@Public()` och `@CurrentUser()`. | Sökvägar beror på arbetskatalogen, och demon, `purge` och testerna har egna `destroy()`. |
| Validering och typer | zod för `RawItem` (en trasig post ska bli `invalid_item`, inte stoppa steget), `sources.json`, `users.json`, `profiles.json` och DTO på varje endpoint. Typa Knex och ta bort de sju `as unknown as`. `entities.id` är heltal men `articles.entity_ids` är text. | Indata och databas litas på utan kontroll. |
| Utskick och export | `DigestService.send` ska använda `CLOCK` (i dag `new Date()`) och vara atomisk. Entitetsimporten i en transaktion och `StreamableFile` med `Content-Disposition` i exporten. Tröskeln 55 och gränsen 18 är gissade, och ett tomt utskick skapar ingen leverans. | Klockan är fast i testerna, och fel mitt i lämnar halva resultat. |
| Index och prestanda | Ny migration med GIN på `search_vector`, `spaces`, `entity_ids`, `categories` och B-träd på `published_at` och `relevance`. Släpp `entity_matches`. Utvärderaren delar upp texten en gång per artikel, och profilfrågan tolkas en gång per körning. | Prestandakraven är inte mätta (100 profiler per artikel under 200 ms). |
| Berikning och åtkomstmodul | Dela `EnrichService` (en `toArticleRow`, separata steg, posterna bär sina `problems`). Fånga AI-fel per post och logga `ai_error` i `skipped_items`, så att en timeout eller 429 inte stoppar steget. Flytta `statusFor` och `excludedByNot` till en `ProfileAdminService`, lägg `RunLogService.latest(step)` och `URGENCIES` i `types.ts`. Åtkomstmodulen är cirka 420 rader. | Svår att läsa och ändra. AI-felen blir akuta med riktig AI (steg 2). |
| Körningar och uppdateringar | Inläsning av profiler loggas inte, `running`-rader efter krasch städas inte och `pipeline_runs` rensas aldrig. Rensningen tar inte `delivery_items` eller `profile_versions`. Uppdateringar sparar ingen tidigare version, en uppdaterad flaggad artikel med giltigt svar blir synlig och inget lås stoppar två samtidiga körningar. Artiklar som sparats men inte matchats före en krasch matchas aldrig (behöver en markering per artikel och profilversion). | Loggen växer, och en krasch eller dubbelkörning kan ge ofullständigt resultat. |
| Entiteter, tid och id | Bara genitiv-s hanteras och alias är skiftlägeskänsliga ("RIKSTAK" missas). Organisationsnummer normaliseras inte och `type = own_brand` styr ingenting. En lokal tid som inte finns eller inträffar två gånger (sommartid) får en av två tolkningar, och bara UTF-8 lästa som Latin-1 repareras. `raw_id` är unikt, så den andra r09 ligger i `skipped_items`. | Kända avgränsningar i pipelinen. Lösning: en flagga per alias, en andra signal (domän, organisationsnummer) och ett beslut om id-kollisioner är ett källfel. |
| Profiler | En ny profil matchas inte mot gamla artiklar i `profile_matches`. `pf-rena` träffar städtipset r08 och `pf-konkurrenter-tak` träffar injektionstexten r19, eftersom frågor ignorerar skiftläge: skriv dem snävare, till exempel `entity:"Rena Fönster"`. | Frågetestaren provar hela arkivet via `matchWholeArchive`, men äldre än 90 dagar finns bara rubrik och sammanfattning. |
| Datamodellen | `memberships`, `visibility_exceptions`, `sections` och `subscriptions` används inte. Omfånget styrs av `content_scopes`, och inget gränssnitt eller API sätter dem. | Se nästa steg 1. |
| Tester och verktyg | Byt `installLlm` mot `overrideProvider(LLM)`, gör `schema.spec.ts` oberoende av ordning och ta bort testet att `sent_articles` inte finns. Arkitekturtestet skannar bara `src` och känner igen Knex på namnet (`knex`, `trx`, `tx`, `db`). ESLint och Prettier i båda paketen, och `noUnusedLocals`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Backend ligger på TypeScript 6 och gränssnittet på 7: skriv in skälet eller jämna ut. | Sköra tester, en detektor som kan luras och inga automatiska stilkontroller. |
| Gränssnittet (`frontend/`) | Visa listan med `isPending` och `placeholderData`, lyft state i `QueryTester` och läs felmeddelandet ur svaret i `api.ts`. Dela typerna via `src/admin/contract.ts` med `import type`. Använd `emerald-700`, `role="status"` och respektera `prefers-reduced-motion`. Byt de handskrivna `ui/`-filerna mot genererade (`npx shadcn add button card`) och skriv komponenttester. | Blinkande lista, dubblerade typer, kontrast och skärmläsare, och inga tester. |

## Var ändrar jag…?

| Vill du ändra | Fil | Gör så här |
|---|---|---|
| Tröskeln för utskick | `src/config/pipeline.config.ts` | Ändra `digest.threshold` (55) eller `maxItems` (18). Triagetröskeln är `TRIAGE_MIN_SCORE` (40), och samma-story-gränsen `DEDUPE_THRESHOLD` (0,92). Båda går att sätta som miljövariabel. |
| Kategorilistan | `src/llm/enrichment.schema.ts` | Ändra `CATEGORIES`. Uppdatera också stubben och `deny_categories` i `content_scopes`. |
| Källornas vikt | `data/sources.json` | Ändra `weight`. Under 1,0 kan källan inte skapa en trend (`trend.service.ts`). |
| En ny profil | `data/profiles.json` | Lägg till `id`, `user` och `query`. Pröva frågan med `npm run query -- '<fråga>'`. En trasig fråga hoppas över med ett felmeddelande. |
| En ny användare | `data/users.json` | Lägg till `id`, `name`, `role` och `scopes`. Demon skriver in `scopes` i `content_scopes`. I produktion sätts de direkt i den tabellen. Admin styrs av `ADMIN_USER_IDS`. |
| Klockan | `src/config/clock.ts` | Sätt `PIPELINE_NOW` (till exempel `2026-10-03T07:00:00+02:00`). I produktion byts den mot systemklockan genom att raden `{ provide: CLOCK, useValue: fixedClock() }` i `src/config/app-config.module.ts` byts mot `{ provide: CLOCK, useValue: { now: () => new Date() } }`. |

## Bra att veta

- Klockan är fast så att körningar går att upprepa. Dag 1 är 2026-10-01 07:00 och demon kör dag 2 med 2026-10-03 07:00.
- Testdatan innehåller medvetna fällor. Varje råpost testar något, se "Fällor i testdatan" i `docs/kodgranskning.md`.
- Två av profilerna i `data/profiles.json` är medvetet trasiga och hoppas över med ett felmeddelande.
- `matchWholeArchive` är det enda undantaget från att originaltexten aldrig läses ut ur åtkomstmodulen. `test/raw-text.spec.ts` bevakar det.
- Adminvyn `view-as` visar högst 200 artiklar, profiler visas med id, och uteslutningar räknas bara på den senaste profilkörningen om den sparat `articleIds`.
- Kategorierna `eget_varumarke` och `ovrigt` är våra tillägg till specens lista.
- `CLAUDE.md` innehåller arbetsreglerna som användes med AI-verktyget. Följ dem, särskilt "test först" och "uppdatera statustabellen".
