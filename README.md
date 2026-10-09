# Bevakningsplattform

Arbetsprov. Just nu innehåller repot den **ärvda koden, oförändrad**, plus det som behövs för att kunna köra den
och visa hur den beter sig. Inga fel är rättade ännu.

## Kom igång

Kräver Node 20+ och Docker.

```bash
npm install
npm run db:up          # startar PostgreSQL i Docker (port 5433)
npm run migrate        # skapar tabellerna
npm run demo           # kör den ärvda pipelinen på testdatan
```

Stoppa och töm databasen med `npm run db:down`.

## Vad demon visar

`npm run demo` läser in entitetsregistret och dag 1-råposterna (`raw_items.json` + `raw_items_extra.json`),
kör dem genom den ärvda pipelinen med AI-stubben och skriver ut vad varje användare får se.
Varje artikel som inte borde nå användaren markeras med ⚠.
En förhandsvisning av mejlet per användare hamnar i `out/` (öppna i webbläsaren).

`npm run demo -- --trasig-ai` gör samma sak men med en AI som svarar ogiltigt, som en riktig modell ibland gör.
Då syns att hela originaltexten hamnar i mejlet.

## Tester

```bash
npm test                 # de ärvda testerna: går gröna
npm run test:kanda-fel   # kända fel: fallerar tills felen är rättade
```

Kontrast med flit: de ärvda testerna är gröna trots att koden läcker innehåll mellan arbetsytor.

## Vad som lagts till för att kunna köra koden

Startkoden saknade `package.json`, migrationer, moduluppsättning, autentisering, CSV-hjälpare och testhjälpare.

| Fil | Vad |
|---|---|
| `package.json`, `tsconfig.json` | Beroenden och TypeScript i strikt läge |
| `docker-compose.yml` | PostgreSQL 16 |
| `migrations/…_arvt_schema.ts` | Återskapat schema: det minsta den ärvda koden förutsätter (inte slutlig datamodell) |
| `src/app.module.ts`, `src/auth/auth.guard.ts`, `src/admin/csv.ts` | Platshållare för saknade delar |
| `test/helpers.ts` | Testhjälpare som de ärvda testerna importerar |
| `scripts/demo.ts` | Demon |
| `test/kanda-fel/` | Tester som visar kända fel |

## Tidsantaganden

Pipelinen körs första gången 2026-10-01 07:00 svensk tid och med `raw_items_dag2.json` 2026-10-03 07:00.
