# Beslutslogg

## 2026-10-09: Gör den ärvda koden körbar innan något rättas

**Beslut:** Första steget är att få den ärvda koden att köra oförändrad, med en demo och tester som visar de kända felen.
**Alternativ:** Börja skriva om direkt.
**Varför:** Felen ska kunna visas och inte bara påstås. Varje rättning kan sedan bevisas med ett test som går från rött till grönt.

## 2026-10-09: Versioner av beroenden

**Beslut:** Senaste versionen av alla paket, med tre undantag:

| Paket | Vald | Senaste | Varför |
|---|---|---|---|
| NestJS | 11 | 12 | NestJS 12 (släppt i augusti 2026) går bara att använda som ES-modul. Jest och ts-node kan då inte ladda den på Node 22 utan omfattande ombyggnad. Uppgiften kräver samma stack som i produktion, och där är 11 det troliga. Antagande att stämma av. |
| TypeScript | 6 | 7 | ts-jest stöder ännu inte TypeScript 7. |
| marked | 15 | 18 | Version 16 och senare finns bara som ES-modul. marked ska ändå bort: sammanfattningar ska renderas som ren, escapad text och inte som Markdown (se kända fel). |

**Alternativ:** Gå över helt till ES-moduler med Vitest och SWC. Det valdes bort på grund av tiden och avståndet till produktionens stack.

`npm audit --omit=dev` ger 0 sårbarheter. De varningar som finns gäller Jests egna verktyg för testtäckning, inte applikationen.

## AI-logg

- **2026-10-09, AI hade fel:** AI-verktyget skrev `package.json` med versioner ur minnet, och flera låg en till två huvudversioner efter. Upptäcktes vid installationen, och versionerna kontrollerades med `npm outdated`. Lärdom: kontrollera alltid versioner mot registret, lita inte på AI:ns minne.
