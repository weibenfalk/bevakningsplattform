# Instruktioner för AI-assistenten i det här repot

## Sammanhang

Arbetsprov i en anställningsprocess: en plattform för omvärldsbevakning (NestJS, TypeScript i strikt läge, PostgreSQL och Knex).
Uppgiften finns i `Arbetsprov-bevakningsplattform.pdf`, om den ligger i repot. Vi har ärvt en kodbas med allvarliga buggar och säkerhetshål.
Bedömningen gäller **beslut och motiveringar, inte mängd kod**, och sker i förhållande till nedlagd tid.

## Status

- Commit 1: ärvd kod, oförändrad. Commit 2–3: koden körbar (Docker, migration, demo, tester) och beroenden uppgraderade.
- `npm test`: de ärvda testerna, gröna (de testar fel saker).
- `npm run test:kanda-fel`: tester för kända fel som ännu inte är rättade (röda tills de rättas). Just nu finns inga, eftersom alla 11 är rättade och flyttade till `test/`. Se statustabellen överst i `docs/kodgranskning.md` för vad som återstår.
- `npm run demo` (och `-- --trasig-ai`) visar läckorna per användare och skriver mejlförhandsvisningar till `out/`.
- Hela kodgranskningen finns i `docs/kodgranskning.md`. Läs den innan du ändrar i `src/`.

## Arbetsregler

1. **Rätta med test först.** Varje rättning ska få ett test i `test/kanda-fel/` att gå från rött till grönt. Flytta sedan
   testet till den vanliga sviten (`test/`).
2. **Uppdatera `docs/beslutslogg.md`** vid varje viktigt beslut: datum, alternativ och varför.
3. **AI-logg** (sist i beslutsloggen): notera när AI:n hjälpte och när den hade fel. Uppgiften kräver 3–5 exempel, varav minst ett fel.
4. **Kontrollera paketversioner** med `npm view <paket> version` innan du lägger till ett beroende. Gissa aldrig ur minnet
   (det har redan gått fel en gång).
5. **Inga personuppgifter** i dokumentation, kod eller commits (gäller även git-författaren). Inga hemligheter i repot.
6. **Ändra aldrig den ärvda logiken tyst.** Förklara alltid vad som var fel och varför.
7. **Uppdatera statustabellen** överst i `docs/kodgranskning.md` varje gång ett fel rättas (eller ett nytt hittas):
   status, testet som bevisar det och hänvisning till beslutet i `docs/beslutslogg.md`.

## Plan, i prioritetsordning

1. **Incidenten**: Anna (fönsterputs) fick en konkursnyhet om takvård med hela artikeln.
   - Skriv om `ArticleAccessService`: omfånget gäller alltid, även för akuta nyheter, och nekade entiteter och
     kategorier gäller överallt. Välj explicita kolumner, aldrig `full_text`. Sortering bara via en vitlista, för att
     stoppa SQL-injektion via `sort`.
   - `EnrichService`: modellen får aldrig bestämma arbetsyta. Om AI-svaret är ogiltigt är artikeln inte klar och ska
     inte publiceras. Fall aldrig tillbaka på originaltexten.
   - `render.ts`: escapa sammanfattningen och ta bort `marked`. Tillåt bara http- och https-länkar.
   - `digest.service.ts`: `otherSources` ska gå via åtkomstmodulen.
   - `export.controller.ts`: `?userId=` får bara användas av admin.
   - Arkitekturtestet: fånga också `knex('articles')`, helst med TypeScript-kompilatorn i stället för regex.
2. **Pipelinebuggar**: `normalizeUrl`, entitetsmatchning (tomma alias, å/ä/ö, böjningar), entitetsimport (validering,
   trimning, EXEMPEL-raden, "Hög", stora id som text), similarity (normalisera vektorerna) och triage (ska inte släppa
   igenom allt när den fallerar).
3. **Frågespråket** (krav 4 i specifikationen): egen tokenizer och rekursiv parser **utan reguljära uttryck**, med minst
   40 tester inklusive syntaxfel (se `data/profiles.json`: `pf-tak-pris` har en oparad parentes och `pf-puts` en
   inledande `*`).
4. **Dokumentation**: `ÖVERLÄMNING.md` (vad fungerar, vad fungerar inte, risker och nästa steg i ordning), `TIDSLOGG.md`
   och färdig beslutslogg med AI-logg.

**Medvetet bortvalt** (dokumenteras som nästa steg i ÖVERLÄMNING.md): AI-router med budgettak, hallucinationsskydd,
verifiering av akutlarm mot en andra källa, riktiga insamlare och robots.txt, embeddings, sök, redaktörsgränssnitt,
larmmotor och kalibrering av trösklar.

## Antaganden (stäm av med företaget eller logga dem)

- Arbetsytan är en hård gräns, även för akuta händelser.
- Koncern är en egen arbetsyta, inte en överordnad som ser allt.
- Tidsstämplar utan tidszon tolkas som Europe/Stockholm.
- Klockan vid körning: dag 1 = 2026-10-01 07:00, dag 2 (`raw_items_dag2.json`) = 2026-10-03 07:00.
- NestJS 11 (inte 12) antas motsvara produktionens version.

## Kommandon

```bash
npm install && npm run db:up && npm run migrate
npm run demo
npm test
npm run test:kanda-fel
npm run typecheck
```
