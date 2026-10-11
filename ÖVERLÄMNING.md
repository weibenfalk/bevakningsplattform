# Överlämning

Till nästa utvecklare. Det här är läget, vad som fungerar och inte, och vad jag skulle göra härnäst.
Detaljerna finns i två dokument: statustabellen överst i `docs/kodgranskning.md` (varje fel, dess status och testet
som bevisar det) och `docs/beslutslogg.md` (varje beslut, med alternativ och motivering).

## Kom igång (fem minuter)

Kräver Node 22.12 eller senare och Docker.

```bash
npm install
npm run db:up          # PostgreSQL i Docker, port 5433
npm run migrate        # skapar alla tabeller (en enda migration)
npm run demo           # kör dag 1 och dag 2 och visar vad varje användare får
npm test               # hela sviten, mot en egen databas (bevakning_test)
```

Annat: `npm run start:admin` (servern med Mikael som admin, för adminverktyget i `frontend/`, se README), `npm start` (servern på 127.0.0.1:3000, se README för exporten), `npm run query -- '<fråga>'` (visar hur en
profilfråga tolkas och vad den träffar), `npm run purge` (rensar fulltext äldre än 90 dagar), `npm run typecheck`.
Har du ändrat i migrationen (senast: `articles.score_breakdown`): kör `npm run db:down` först, eftersom datamodellen ligger i en enda migration.

## Hur kedjan hänger ihop

```
råposter → inläsning → dubblettkontroll → triage → berikning → poäng → profilmatchning → utskick per mottagare
          (ingest.ts)  (dedupe.ts)        (AI)     (AI)        (score.ts) (query/)        (digest/)
```

| Var | Vad |
|---|---|
| `src/access/` | Den enda vägen till innehållstabellerna. Lägger på användarens omfång. Arkitekturtestet fäller bygget om annan kod läser dem direkt. |
| `src/pipeline/` | Stegen i kedjan, samlade i `pipeline.service.ts`. Varje steg loggar sin körning i `pipeline_runs`. |
| `src/query/` | Frågespråket: tokenizer, parser och utvärdering, utan reguljära uttryck. |
| `src/llm/` | `LlmProvider`-gränssnittet och stubben. All AI går genom gränssnittet. |
| `src/digest/` | Urval och rendering av mejlet. Sparar vad som skickats i `editions`, `deliveries` och `delivery_items`. |
| `src/admin/`, `frontend/` | Export och det läs-bara adminverktyget (visa som annan användare, med "Varför: profil (term)"). Gränssnittet har eget `package.json`. |
| `migrations/` | Hela datamodellen, inklusive behörighet, i en migration (krav 2). |
| `test/` | Testerna. `architecture-scan.ts` är detektorn bakom arkitekturtestet. |

Grundregler i koden, som ändringar bör följa:
- **Fail closed.** Vid osäkerhet: hellre att ingen får en nyhet än att fel person får den. Inga tysta standardvärden.
- **Omfånget gäller överallt.** Arbetsytan är en hård gräns, även för akuta händelser och rättelser.
- **Aldrig fulltext ut.** Bara åtkomstmodulens kolumnlista lämnar modulen, och `full_text` finns inte i den.
- **Idempotens.** Allt kan köras om utan dubbletter, och utan nya AI-anrop.

## Vad som fungerar

Allt med status "rättat" i statustabellen. I korthet:
- Behörigheten: arbetsyta, tillåtna och nekade kategorier, källor och entiteter, högsta brådska. Nekat vinner alltid.
- Incidenten (en fönsterputsanvändare fick en konkursnyhet om takvård med hela texten) har tre orsaker, och alla är
  rättade och testade (fel 1, 4 och 5).
- Inläsning med reparation av teckenkodning och tidszoner, dubblettkontroll på normaliserad URL, uppdateringar av
  befintliga artiklar, rättelser som alltid kommer med.
- Triage som inte släpper igenom allt, berikning validerad mot fasta listor, poäng enligt specens formel med
  trend- och uppföljningsfaktor.
- Frågespråket, och profilmatchning i batch efter berikningen (krav 3). Mejlet visar varför en artikel kom med.
- Utskick per mottagare. Det som redan skickats skickas inte igen.
- Export som CSV, med skydd mot formler i Excel.
- Adminverktyget "visa som annan användare": läs-bart, med poängens uppdelning per artikel (sparad vid uträkningen, ingen för äldre artiklar) en sektion med användarens profiler (status, version, träffade artiklar med raw_id, vad en NOT uteslöt, trasiga profiler läses ur profilfilen) och en frågetestare, bara admin, via åtkomstmodulen och utan fulltext. Gränssnittet är byggt och provat via proxyn men inte klickat igenom i en webbläsare och har inga egna tester.
- Rensning av fulltext efter 90 dagar.

## Vad som inte fungerar, kända fel och risker

| Risk | Vad det innebär | Var |
|---|---|---|
| **Inloggningen är en platshållare** | `AuthGuard` litar på headern `x-user-id`. Vem som helst som når servern kan utge sig för att vara någon annan, även admin. Servern lyssnar därför bara på 127.0.0.1. Får inte exponeras innan riktig inloggning finns. | Fel 18 |
| **Allt körs mot stubben** | Stubben sätter arbetsyta och påverkan efter nyckelord. Poängen visar att flödet fungerar men är ingen bedömning. Ingen riktig AI är testad. | `src/llm/stub.provider.ts` |
| Obekräftade källor kan hamna högt | Ryktet r19 (“Rikstak i konkurs?!”) från ett forum får 79 poäng och kommer med i utskicket för takvård. Svaga källor (vikt under 1,0) kan inte längre skapa en trend, vilket sänkte r19 från 99. Men ett rykte kan fortfarande passera tröskeln. Gränsen 1,0 är inte kalibrerad. Den riktiga lösningen är verifiering mot en andra källa. | Fel 4b och 49 |
| **AI:n kan välja fel men giltig arbetsyta** | Valideringen stoppar ogiltiga svar, inte felaktiga. En modell som luras av injektionstext kan skicka en nyhet till fel arbetsyta. | Fel 4b |
| **Klustring saknas** | Samma story från flera källor (r01/r02, r16/r17) skickas som separata nyheter. Tröskeln för samma story är inte kalibrerad, och märkt data saknas. | Fel 29, 30 |
| **`ArticleAccessService` har blivit stor** | Cirka 420 rader: artikelläsning, arkivmatchning, identiteter för dubblettkontrollen, utskicksloggen, trendräkning och profilträffar. Fungerar och är testad, men är svår att överblicka. | `src/access/` |
| **Profiler matchas bara mot nya artiklar** | Frågetestaren (admin) provar en fråga mot hela arkivet med samma text som pipelinen (originaltexten, inne i åtkomstmodulen) och visar per träff om vald användare skulle se artikeln och varför inte. I en riktig version ska en redaktör bara se träffar inom sin egen behörighet (`matchWholeArchive` har inget användaromfång och får bara anropas efter en adminkontroll), men artiklar äldre än 90 dagar har rensad text och provas bara på rubrik och sammanfattning. En ny profil matchas inte mot gamla artiklar i `profile_matches`. Prestandakravet (under 2 sekunder mot 30 dagar) är inte mätt: upp till 5000 artiklar med text läses in och utvärderas i minnet. `matchWholeArchive` är det enda undantaget från att originaltexten aldrig läses ut ur åtkomstmodulen, och det bevakas av `test/raw-text.spec.ts`. | Beslutsloggen |
| **Delar av datamodellen används inte** | `memberships`, `visibility_exceptions`, `sections` och `subscriptions` finns men används inte. Omfånget styrs av `content_scopes`, profilerna läses in från `data/profiles.json` vid varje körning och synligheten per profil tillämpas inte. En förvald publikation används. | Datamodellen |
| **Inga riktiga mejl** | Utskicket sparas och renderas till `out/`, men skickas inte. Plaintextversion, dark mode och avregistreringslänk saknas. | `src/digest/` |
| **Prestandakraven är inte mätta** | Inget av kraven i specens avsnitt 10 (till exempel arkivsök under 800 ms) är mätt. | – |

## Kvar från besluten (kort, en rad per punkt)

Det här stod som "kvarstår" i beslutsloggen. Beslutsloggen innehåller bara besluten, så det finns samlat här.

- **Entiteter:** organisationsnummer har olika format och normaliseras inte, `type = own_brand` styr ingenting i pipelinen, och `entities.id` är ett heltal medan `articles.entity_ids` är text.
- **Entitetsmatchning:** bara genitiv-s hanteras och alias är skiftlägeskänsliga, så "RIKSTAK" och "rikstak" missas. Lösning: en flagga per alias i registret, eller en andra signal (domän, organisationsnummer).
- **Inläsning:** en lokal tid som inte finns eller inträffar två gånger (sommartidens start och slut) får en av två tolkningar, och bara UTF-8 lästa som Latin-1 repareras.
- **`raw_id` är unikt:** den andra r09 sparas inte som artikel utan ligger hel i `skipped_items`. Öppet val: göra `raw_id` icke-unikt när det är klarlagt om id-kollisioner är ett källfel.
- **Uppdateringar:** den tidigare versionen sparas inte (ingen historik), en uppdatering av en flaggad artikel med giltigt svar blir synlig, och det finns inget lås mot två samtidiga körningar.
- **Körningslogg:** inläsningen av profiler loggas inte, `running`-rader efter en krasch städas inte, och `pipeline_runs` rensas aldrig (listan `articleIds` per profilkörning växer).
- **Rensning:** `delivery_items` och `profile_versions` ingår inte, och inget schemalägger jobbet.
- **Profilmatchning:** artiklar som sparats men inte hunnit matchas före en krasch matchas aldrig (behöver en markering per artikel och profilversion), 100 profiler per artikel under 200 ms är inte mätt (frågan tolkas om per profil och körning), och den semantiska delen, filtren och profilens extra instruktion används inte.
- **Träffar som förvånar:** `pf-rena` träffar städtipset r08 och `pf-konkurrenter-tak` träffar injektionstexten r19, eftersom frågor är skiftlägesokänsliga. Skriv profilerna snävare (till exempel `entity:"Rena Fönster"`).
- **Fält:** `author`, `region` och `lang` läggs till i `PROFILE_FIELDS` när artiklarna får dem (språkigenkänning, insamlare som levererar dem).
- **Omfång:** inget gränssnitt eller API sätter listorna i `content_scopes`. En artikel utan källa träffas inte av en nekad källa men släpps inte in av en icke-tom `allow_sources` (antagande att stämma av).
- **Kategorier:** `eget_varumarke` och `ovrigt` är våra tillägg till specens lista, och äldre rader med tom `categories` döljs inte av `deny_categories`.
- **HTTP:** bara exporten och adminvägarna finns. Sök, arkiv, API och utskick (specens "omfånget gäller överallt") saknar endpoints.
- **Utskick:** tröskeln 55 och gränsen 18 artiklar är gissade, ett tomt utskick skapar ingen leverans, och "Även:" i mejlet ska använda `sourceLabel` (visar i dag id:t) när klustringen byggs.
- **Arkitekturtestet:** skannar bara `src` (skript och tester undantas) och känner igen en knex-instans på namnet (`knex`, `trx`, `tx`, `db`).
- **Adminvyn:** `view-as` visar högst 200 artiklar, profiler visas med id, och uteslutningar räknas bara på den senaste profilkörningen om den sparat `articleIds`.

## Nästa steg, i ordning

**1. Gör det som finns användbart och säkert.**
Riktig inloggning (till exempel företagets SSO) och rollerna från datamodellen i bruk. Dela upp åtkomstmodulen i flera
tjänster inom `src/access/` (artiklar, utskick, statistik), med samma arkitekturtest. Bygg klustring när märkt data
finns att kalibrera mot.
*Varför först:* ett system som kan läcka data eller skickar samma story tre gånger blir inte bättre av fler funktioner.
Kodskuld från granskningen (ingen läcka, men det som gör koden svårare att ändra):
- Dela `AppModule` per område (databas, referensdata, åtkomst, AI, pipeline, profiler, utskick, admin, auth). Filläsningen vid import flyttas till `useFactory`.
- Stäng databaspoolen i en `OnApplicationShutdown` och slå på `enableShutdownHooks()` (i dag har demon, `purge` och testerna egna `destroy()`).
- Validera gränserna med zod: `RawItem` vid inläsning (en trasig post ska bli `invalid_item`, inte stoppa steget), `sources.json`, `users.json`, `profiles.json`, och DTO med pipe på varje endpoint (`sort` är redan rättad).
- Typa Knex (`knex<ArticleRow>` eller en `Tables`-deklaration) och ta bort de sju `as unknown as` i åtkomstmodulen.
- `DigestService.send` ska använda `CLOCK` (i dag `new Date()`), och bygget och loggningen ska vara atomiska.
- Index i en ny migration: GIN på `search_vector`, `spaces`, `entity_ids`, `categories`, och B-träd på `published_at` och `relevance`. Släpp den oanvända tabellen `entity_matches`.
- Dela `EnrichService`: en `toArticleRow` som insättning och uppdatering delar, och separata steg för inläsning och berikning (låt posterna bära sina `problems` i stället för en `Map` på objektidentitet).
- Flytta `statusFor` och `excludedByNot` till en `ProfileAdminService`, och lägg `RunLogService.latest(step)` i stället för att läsa alla körningar.
- Lägg `URGENCIES` (som `SPACES`) i `types.ts`, så att brådskans ordning och värden finns på ett ställe.
- Importen av entiteter i en transaktion, en gemensam `dataDir()` i stället för sökvägar relativa till arbetskatalogen, och `StreamableFile` med `Content-Disposition` i exporten.
- Vid riktig inloggning: global guard med `@Public()` och `@CurrentUser()` i stället för `@Req()`.
- Testerna: byt ut `installLlm` (skriver över privata fält) mot `overrideProvider(LLM)`, gör `schema.spec.ts` oberoende av ordning och ta bort testet att `sent_articles` inte finns.
- Utvärderaren delar upp texten en gång per artikel i stället för per term (hör ihop med prestandakravet som inte är mätt).
- ESLint (`typescript-eslint`, `react-hooks`) och Prettier i båda paketen, och slå på `noUnusedLocals`, `noUncheckedIndexedAccess` och `noImplicitOverride`. Backend ligger på TypeScript 6, gränssnittet på 7 (förmodligen för `ts-jest`): skriv in skälet eller jämna ut.

**2. Riktig AI och riktiga utskick.**
En riktig leverantör bakom `LlmProvider`, via en router med modellval i konfiguration, reservmodell, omförsök och
kostnadsräkning. Budgettak per leverantör och dygn. Hallucinationsskydd (tal i sammanfattningen måste finnas i
källtexten). Verifiering av akutlarm mot en andra källa, vilket också löser r19-risken. Välj leverantör genom att köra
två eller tre kandidater mot ett märkt testset (krav: data inom EU, bra svenska, under 60 kronor per utskick). Sedan
riktiga mejl via en mejltjänst, och publikationer och prenumerationer i bruk.
*Varför före insamlingen:* det går att bygga och mäta med testdatan som finns. Insamlingen kräver mer arbete och juridiska
överväganden.
Kodskuld: berikningen går en post i taget och ett fel från leverantören (timeout, 429) stoppar hela steget. Fånga per post, logga som `ai_error` i `skipped_items`, begränsa parallellismen och räkna om i omgångar.

**3. Riktig insamling.**
En basklass för källor med robots.txt och högst en förfrågan per två sekunder per domän, och en adapter per källtyp
(RSS, JSON, HTML, PDF, kungörelser, recensioner, platsannonser). Övervakning av källhälsa, så att en tyst källa syns.
Schemaläggning av pipelinen och av rensningen. Adaptrarna behöver bara leverera `RawItem`, resten av kedjan är oförändrad.
*Varför här:* det är den största delen, och den är meningslös innan steg 1 och 2 gör resultatet säkert och bra.

**4. Verktyg för redaktörer och admin.**
Mät frågetestaren mot kravet (under 2 sekunder mot 30 dagar), redaktionell arbetsyta för att godkänna en utgåva,
skrivande adminfunktioner (användare och behörighet, först efter riktig inloggning och med revisionslogg), arkiv och sök, larmmotor och feedback.
*Varför sist:* verktygen bygger på att allt ovan fungerar.
Kodskuld i gränssnittet:
- Visa listan med `isPending` och `placeholderData` i stället för att dölja den vid varje bakgrundshämtning (fönsterfokus), och byt effekt-och-räknare i `QueryTester` mot lyft state.
- Dela typerna med backend: en `src/admin/contract.ts` utan Nest-importer som gränssnittet läser med `import type`. Ge svaren från `/admin/users` och `/admin/view-as` namngivna typer.
- Läs felmeddelandet ur svaret i `api.ts` (i dag visas bara `statusText`).
- Tillgänglighet: `emerald-700` i stället för `emerald-600` (under 4,5:1 mot vitt), `role="status"` på laddytor, och ingen mjuk scroll vid `prefers-reduced-motion`.
- Byt de handskrivna `ui/`-filerna mot genererade (`npx shadcn add button card`) när fler varianter behövs, och skriv komponenttester.

Löpande: mät prestandakraven och målen i specen (inga missade regeländringar, under 20 procent falska träffar i
konkurrentbevakningen, under 60 kronor per utskick). Det kräver märkt data, och det bör finnas tidigt.

## Bra att veta

- Klockan är fast, så att körningar går att upprepa: dag 1 är 2026-10-01 07:00 (`src/config/clock.ts`, kan sättas med
  `PIPELINE_NOW`), och demon kör dag 2 med 2026-10-03 07:00. I produktion byts den mot systemklockan.
- Testdatan innehåller medvetna fällor. Varje råpost testar något, se "Fällor i testdatan" i `docs/kodgranskning.md`.
- Två av profilerna i `data/profiles.json` är medvetet trasiga och hoppas över med ett felmeddelande.
- `CLAUDE.md` innehåller arbetsreglerna som användes med AI-verktyget. Följ dem, särskilt "test först" och "uppdatera
  statustabellen".
