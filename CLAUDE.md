# Instruktioner för AI-assistenten i det här repot

## Sammanhang

Arbetsprov i en anställningsprocess: en plattform för omvärldsbevakning (NestJS, TypeScript i strikt läge, PostgreSQL och Knex).
Uppgiften finns i `Arbetsprov-bevakningsplattform.pdf`, om den ligger i repot. Vi har ärvt en kodbas med allvarliga buggar och säkerhetshål.
Bedömningen gäller **beslut och motiveringar, inte mängd kod**, och sker i förhållande till nedlagd tid.

## Status

- Commit 1: ärvd kod, oförändrad. Commit 2–3: koden körbar (Docker, migration, demo, tester) och beroenden uppgraderade.
- `npm test`: 629 tester, gröna, i den vanliga sviten (`test/`). Äldre ärvda tester som testade fel saker är ersatta.
- De 11 kända felen är rättade, liksom flera fel som hittades vid granskningen (se statustabellen överst i `docs/kodgranskning.md`, som också visar vad som återstår). Före-läget med alla 11 som röda tester finns i git-historiken (commit `8cb6c87`, `test/kanda-fel/kanda-fel.spec.ts`).
- Incidenten, pipelinebuggarna (plan 1 och 2) och dedupe/idempotens är gjorda. Hela datamodellen (krav 2) ligger i den första migrationen, men tabellerna för behörighet, profiler och utskick används inte av koden än (`content_scopes` styr omfånget, med arbetsyta, tillåtna och nekade kategorier, källor och entiteter samt högsta brådska).
- Frågespråket (plan 3) är byggt i `src/query/` (tokenizer, parser, utvärdering) och inkopplat: `PipelineService` läser in profilerna, berikar och matchar profilerna mot de nya artiklarna (`profile_matches`). Mejlet visar "Varför: …" för användarens egna profiler. Profilerna filtrerar **inte** urvalet (se beslutsloggen).
- Dag 2 är gjord: `d01` är en dubblett, `d02` uppdaterar `r02` (ny text och poäng, uppföljning, skickas inte igen), `d05` är en rättelse som alltid är med. Utskicken sparas i `editions`, `deliveries` och `delivery_items` (`DigestService.send`).
- Rensning efter 90 dagar (fel 35) är gjord: `npm run purge` nollar `articles.full_text` och tömmer `skipped_items.payload`, räknat mot den fasta klockan (artiklar och råposter har `created_at` satt av klockan), och loggas i `pipeline_runs`.
- Trendfaktorn (fel 21 och 26) är inkopplad: minst 3 unika artiklar om samma entitet de senaste 30 dygnen på `published_at` ger ×1,25 (`TrendService`, `test/trend.spec.ts`).
- `ÖVERLÄMNING.md`, `TIDSLOGG.md` och beslutsloggen finns (plan 4). Kodgranskningen inför överlämning är gjord och dess rättningar står som fel 56–62 i statustabellen. Resten står som "Kodskuld" under "Nästa steg" i `ÖVERLÄMNING.md`. Äkta autentisering saknas (`AuthGuard` är en platshållare).
- Adminverktyget "visa som annan användare" (läs-bart) är gjort: `GET /admin/users` och `/admin/view-as/:userId` (`src/admin/admin.controller.ts`) och ett gränssnitt i `frontend/` (eget `package.json`, se README). `npm run start:admin` startar servern med `ADMIN_USER_IDS=u-mikael`. Verktyget visar också poängens uppdelning (`articles.score_breakdown`, sparas när poängen räknas ut) och har en frågetestare (`POST /admin/query-test`).
- `npm run demo` (och `-- --trasig-ai`) visar läckorna per användare och skriver mejlförhandsvisningar till `out/`.
- Hela kodgranskningen finns i `docs/kodgranskning.md`. Läs den innan du ändrar i `src/`.

## Arbetsregler

1. **Rätta med test först.** Skriv testet i den vanliga sviten (`test/`), kör det och se att det är rött av rätt skäl,
   rätta, och se det bli grönt. Visa båda körningarna.
2. **Uppdatera `docs/beslutslogg.md`** vid varje viktigt beslut: datum, alternativ och varför.
3. **AI-logg** (sist i beslutsloggen): notera när AI:n hjälpte och när den hade fel. Uppgiften kräver 3–5 exempel, varav minst ett fel. Loggen hålls till högst 6 punkter (de starkaste); besluten ligger kvar i loggen.
4. **Kontrollera paketversioner** med `npm view <paket> version` innan du lägger till ett beroende. Gissa aldrig ur minnet
   (det har redan gått fel en gång).
5. **Inga personuppgifter i beslutsloggen eller `ÖVERLÄMNING.md`** (så står det i uppgiften: koden hanteras utan ditt namn och utan git-historik). Git-författaren är kandidatens eget namn och är normalt, historiken skrivs inte om. Testdatan är påhittad. Inga hemligheter i repot.
6. **Ändra aldrig den ärvda logiken tyst.** Förklara alltid vad som var fel och varför.
7. **Uppdatera statustabellen** överst i `docs/kodgranskning.md` varje gång ett fel rättas (eller ett nytt hittas):
   status, testet som bevisar det och hänvisning till beslutet i `docs/beslutslogg.md`.
8. **Ett test per beteende.** Varianter av samma beteende med olika indata skrivs som `test.each` med en tabell, inte som flera nästan likadana test. Skriv inget test för trivialiteter (att en konstant har ett visst värde, att en fil heter något) och inget som bara upprepar ett annat test: kontrollera att ett namngivet test täcker samma sak innan du tar bort något. Säkerhetstesten (behörighet, fulltext, HTML, länkar, export) behåller sina assertioner.

## Plan, i prioritetsordning

1. ~~**Incidenten**~~ (klar): `ArticleAccessService` med omfång som alltid gäller, explicita kolumner och vitlistad `sort`. `EnrichService` utan modellstyrd arbetsyta och utan reserv till originaltexten. `render.ts` utan `marked` och med bara http(s)-länkar. `otherSources` via åtkomstmodulen. `?userId=` bara för admin.
   - Arkitekturtestet läser koden med TypeScript-kompilatorn (`test/architecture-scan.ts`) och fångar alla sätt att nå innehållstabellerna utanför `src/access`. Undantag finns bara för skrivning i pipelinen (listan i `test/architecture.spec.ts`, med motivering).
2. ~~**Pipelinebuggar**~~ (klar, utom det som står som "kvar" i statustabellen): `normalizeUrl`, entitetsmatchning, entitetsimport, similarity och triage.
3. **Frågespråket** (krav 4 i specifikationen) – **klar och inkopplad** (se beslutsloggen). Frågetestaren (admin, mot arkivet via åtkomstmodulen) är gjord. Kvar: semantisk del. Ursprungligt krav: egen tokenizer och rekursiv parser **utan reguljära uttryck**, med minst
   40 tester inklusive syntaxfel (se `data/profiles.json`: `pf-tak-pris` har en oparad parentes och `pf-puts` en
   inledande `*`). Kopplas sedan till `profile_matches` (tabellen finns redan).
4. **Dokumentation**: `ÖVERLÄMNING.md` (vad fungerar, vad fungerar inte, risker och nästa steg i ordning), `TIDSLOGG.md`
   och färdig beslutslogg med AI-logg (AI-loggen har högst sex punkter: tre där AI:n hjälpte och tre där den hade fel eller styrdes om).

**Medvetet bortvalt** (dokumenteras som nästa steg i ÖVERLÄMNING.md): AI-router med budgettak, hallucinationsskydd,
verifiering av akutlarm mot en andra källa, riktiga insamlare och robots.txt, embeddings, sök, redaktörsgränssnitt,
larmmotor och kalibrering av trösklar. Samma gäller att koppla in behörighetstabellerna (`memberships` m.fl.).

## Krav i specen som styr koden (inga antaganden)

- **Arbetsytan är en hård gräns, även för akuta händelser.** Specens avsnitt 2: "arbetsytor (hård gräns)" och
  "Omfånget gäller överallt: sök, arkiv, export, API, utskick och förhandsgranskning." Det finns inget undantag för akuta
  händelser. Att "akuta händelser kan skickas utanför schemat" (avsnitt 7) gäller *när* de skickas, inte *vem* som får
  se dem.

## Antaganden (stäm av med företaget eller logga dem)

- Koncern är en egen arbetsyta, inte en överordnad som ser allt.
- Tidsstämplar utan tidszon tolkas som Europe/Stockholm.
- Klockan vid körning: dag 1 = 2026-10-01 07:00, dag 2 (`raw_items_dag2.json`) = 2026-10-03 07:00.
- NestJS 11 (inte 12) antas motsvara produktionens version.

## Kommandon

```bash
npm install && npm run db:up && npm run migrate   # efter en ändring av första migrationen: npm run db:down först
npm run demo
npm start                # servern på 127.0.0.1:3000 (PORT, HOST, DATABASE_URL, ADMIN_USER_IDS)
npm test
npm run typecheck
```
