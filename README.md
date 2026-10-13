# Bevakningsplattform

En plattform för omvärldsbevakning åt en koncern med två affärsområden (takvård och fönsterputs). Den läser in råposter från nyhetskällor, kungörelser, recensioner och forum, låter en AI-modell sortera och berika dem, och skickar varje mottagare bara det som rör hens arbetsyta.
Tekniken är NestJS, TypeScript i strikt läge, PostgreSQL och Knex. Repot började som en ärvd kodbas med allvarliga buggar och säkerhetshål.

**Börja här:** [`ÖVERLÄMNING.md`](ÖVERLÄMNING.md) och [sammanfattningen i beslutsloggen](docs/beslutslogg.md#de-viktigaste-besluten). Status per fel finns i [`docs/kodgranskning.md`](docs/kodgranskning.md).

## Kom igång

Kräver Node 22.12 eller senare och Docker.

```bash
npm install
npm run db:up          # startar PostgreSQL i Docker (port 5433)
npm run migrate        # skapar tabellerna
npm run demo           # kör pipelinen på testdatan och fyller databasen `bevakning`
npm test               # hela testsviten, mot databasen `bevakning_test`
npm start              # startar servern på http://127.0.0.1:3000
npm run query -- "Rikstak AND NOT pumpa*"   # prövar en fråga mot testdatan, utan databas
npm run purge          # rensar fulltext och råposter äldre än 90 dagar (mot pipelinens klocka)
```

Stoppa och töm databasen med `npm run db:down`.

## Starta servern

`npm start` startar `AppModule` (`src/main.ts`), som sätter ihop en modul per område (`*.module.ts` i varje mapp under `src/`). Controllers finns bara i `src/admin/` (adminverktyget) och `src/export/` (CSV-exporten). Resten körs av skripten.

| Inställning | Standard | Vad |
|---|---|---|
| `PORT` | `3000` | Port. Ett ogiltigt värde ger 3000. |
| `HOST` | `127.0.0.1` | Adress. Servern är bara nåbar från den egna datorn, se varningen nedan. |
| `DATABASE_URL` | den lokala Docker-databasen | Krävs i produktion (`NODE_ENV=production`). |
| `ADMIN_USER_IDS` | tom (ingen är admin) | Kommaseparerade användar-id som är admin. |
| `PIPELINE_NOW` | `2026-10-01T07:00:00+02:00` | Pipelinens fasta klocka. Ett ogiltigt datum stoppar starten med ett tydligt fel. |

Alla inställningar i `src/` läses och kontrolleras vid start på ett ställe, `src/config/configuration.ts`. Skripten i `scripts/` läser `DATABASE_URL` själva.

> **Varning: `x-user-id` är en platshållare, inte inloggning.** Servern litar på headern `x-user-id` och kontrollerar
> inte att anroparen är den hen utger sig för att vara. Vem som helst som når servern kan skicka en annan användares id
> (även en admins) och få hens innehåll. Därför lyssnar servern som standard bara på `127.0.0.1`. Ändra inte `HOST` till
> något nåbart utifrån förrän riktig inloggning finns (se fel 18 i statustabellen). Rollen "admin" kommer från serverns
> konfiguration (`ADMIN_USER_IDS`) och inte från anropet, men den skyddar bara så länge identiteten är äkta.

## Exportera artiklar (curl)

Kör `npm run demo` först så att det finns artiklar. Testanvändarna är `u-mikael` (koncern, takvård och fönsterputs),
`u-kalle` (takvård) och `u-anna` (fönsterputs).

```bash
# Som vanlig användare: Anna får bara fönsterputs
curl -H 'x-user-id: u-anna' http://127.0.0.1:3000/export/articles.csv

# Utan användare: 401
curl -i http://127.0.0.1:3000/export/articles.csv

# En vanlig användare kan inte exportera någon annans innehåll: 403
curl -i -H 'x-user-id: u-anna' 'http://127.0.0.1:3000/export/articles.csv?userId=u-kalle'

# Sortering (vitlista: relevance, published_at, impact, raw_id, id; asc eller desc). Annat ger 400
curl -H 'x-user-id: u-kalle' 'http://127.0.0.1:3000/export/articles.csv?sort=published_at%20desc'
```

Som admin startar du servern med `ADMIN_USER_IDS` och anger vem du vill se som:

```bash
ADMIN_USER_IDS=u-mikael npm start

# Mikael (admin) exporterar som Kalle
curl -H 'x-user-id: u-mikael' 'http://127.0.0.1:3000/export/articles.csv?userId=u-kalle'

# Samma anrop som en icke-admin ger 403, även om anroparen skickar en roll i anropet
curl -i -H 'x-user-id: u-anna' -H 'x-user-role: admin' 'http://127.0.0.1:3000/export/articles.csv?userId=u-kalle'
```

Svaret är CSV med kolumnerna `id,title,url,relevance`. Aldrig fulltext. Celler som börjar med `=`, `+`, `-` eller `@`
får ett inledande `'` så att de inte tolkas som formler i Excel.

## Adminverktyg: visa som en annan användare

Ett läs-bart verktyg (specens avsnitt 2): välj en användare och se artiklarna hen ser, och varför de kom med
("Varför: profil (term)"). Inget skrivs. Det kräver två terminaler och att demon har körts (`npm run demo`).

```bash
# Terminal 1, i rotmappen: servern med Mikael som admin (ADMIN_USER_IDS=u-mikael)
npm run start:admin

# Terminal 2: gränssnittet på http://localhost:5173
cd frontend
npm install
npm run dev
```

Vite skickar `/admin` vidare till `127.0.0.1:3000` (proxy i `frontend/vite.config.ts`), så CORS behövs inte. Gränssnittet
skickar `x-user-id: u-mikael`. Annan admin: `VITE_ADMIN_USER_ID=u-annan npm run dev`, och starta servern med
`ADMIN_USER_IDS=u-annan npm start`. Utan admin ger servern 403 och gränssnittet visar felet.

Samma sak med curl:

```bash
curl -H 'x-user-id: u-mikael' http://127.0.0.1:3000/admin/users
curl -H 'x-user-id: u-mikael' http://127.0.0.1:3000/admin/view-as/u-kalle
curl -H 'x-user-id: u-mikael' http://127.0.0.1:3000/admin/users/u-kalle/profiles
```

`frontend/`: `npm run typecheck` kontrollerar typerna och `npm run build` bygger. Samma varning som ovan gäller:
identiteten är en platshållare, så starta inte servern på en adress som andra når. Varför verktyget är läs-bart och inte
hanterar användare: se beslutsloggen (2026-10-10, adminverktyget).

### Profiler, poängens uppdelning och frågetestaren

Verktyget visar användarens profiler (status, version och träffar), en rad "Så räknades poängen" per artikel och en frågetestare som provar en fråga mot hela arkivet, bara för admin. Frågetestaren returnerar aldrig fulltext.
Databasen måste skapas om efter en ändring av migrationen (`npm run db:down`, `db:up`, `migrate`, `demo`). Detaljerna står i [`ÖVERLÄMNING.md`](ÖVERLÄMNING.md).

```bash
curl -H 'x-user-id: u-mikael' -H 'content-type: application/json' \
  -d '{"userId":"u-kalle","query":"(Rikstak OR Takvårdarna) AND NOT pumpa*"}' \
  http://127.0.0.1:3000/admin/query-test
```

## Vad demon visar

`npm run demo` kör dag 1 och dag 2 genom pipelinen med AI-stubben och skriver ut vad varje användare får, vad som hoppades över och varför. Förhandsvisningar av utskicken hamnar i `out/`. Med `-- --trasig-ai` svarar AI:n ogiltigt och artiklarna flaggas för granskning.
Vad utskriften ska visa, och hur du läser den, står under "Kom igång" i [`ÖVERLÄMNING.md`](ÖVERLÄMNING.md).

## Frågespråket (`npm run query`)

`npm run query -- "<fråga>"` visar vad frågespråket (`src/query/`) gör med en fråga. Ingen databas behövs, datan
läses direkt från `data/`. Dag 1 är `raw_items.json` och `raw_items_extra.json`, alltså samma som demon läser (med r19–r22). Dag 2 är `raw_items_dag2.json`. Felkodad text repareras som i pipelinen. r09 förekommer två gånger i dag 1 och visas därför två gånger. Skriptet skriver ut tre saker:

1. **Tokens**, en per rad med position.
2. **Trädet**, indenterat.
3. **Träffar**: vilka artiklar i dag 1 och dag 2 som matchar, och vilken term som gav träffen (termer under `NOT` räknas inte).

```bash
npm run query -- '(Rikstak OR Takvårdarna) AND NOT pumpa*'
npm run query -- '"Rena Fönster" OR fönsterput*'
npm run query -- 'Rikstak NEAR/3 takmålning'
```

Vid syntaxfel visas frågan med en `^` under positionen, och skriptet avslutas med kod 1. De två trasiga profilerna
i `data/profiles.json` ger till exempel:

```text
$ npm run query -- '*putsning OR fallskydd'
Syntaxfel:
  *putsning OR fallskydd
  ^
  Wildcard (*) får bara stå sist i ett ord, till exempel pumpa*, inte först eller mitt i (position 1)
```

Kom ihåg att citera frågan i skalet (enkla citattecken), annars tolkar skalet parenteser, `*` och `"`.
Samma frågespråk används av pipelinen (profilmatchning efter berikningen). Regler och val står i `docs/beslutslogg.md`.

## Tester

```bash
npm run db:up            # Postgres måste vara igång
npm test                 # hela sviten
npm run typecheck
```

Testerna ligger som `*.spec.ts` i `test/`. Status per fel, med testet som bevisar det, finns i [`docs/kodgranskning.md`](docs/kodgranskning.md). Hjälpfiler: `helpers.ts`, `architecture-scan.ts`, `test-database.ts`, `jest.env.ts` och `jest.global-setup.ts`.

**Testerna har en egen databas.** De kör mot `bevakning_test` på samma Postgres-server som demon, och `npm test`
rör därför aldrig demodatan i `bevakning`. Testdatabasen skapas automatiskt första gången (Jest `globalSetup`, se
`test/jest.global-setup.ts`) och tabellerna skapas av migrationerna, så ingen manuell uppsättning behövs. Du behöver
inte köra `npm run migrate` för testerna.

- Testerna tvingar sin egen `DATABASE_URL` (`test/jest.env.ts`), även om miljön pekar någon annanstans.
- `TEST_DATABASE_URL` byter testdatabas, till exempel i CI. Namnet **måste sluta på `_test`**. Testhjälparna vägrar
  annars köra, eftersom de tömmer tabellerna (`test/test-database.ts`).
- Serverns `DATABASE_URL` räknas aldrig för testerna, eftersom den kan peka på en databas som inte får tömmas.
- `npm run db:down` tar bort båda databaserna.
- Loggen är tyst i testerna (trasiga svar testas med flit). `TEST_LOGS=1 npm test` visar den när något felsöks.
  Produktionen och demon loggar som vanligt.

## Struktur

Hur mapparna hänger ihop och var du ändrar tröskel, profiler, användare och klocka står i [`ÖVERLÄMNING.md`](ÖVERLÄMNING.md) (avsnitten "Hur det hänger ihop" och "Var ändrar jag…?").

## Platshållare som saknades i startkoden

Startkoden saknade `package.json`, migrationer, moduluppsättning, autentisering, CSV-hjälpare och testhjälpare. Dessa är
återskapade eller ersatta: `src/app.module.ts`, `src/auth/auth.guard.ts` (en platshållare, se varningen ovan),
`src/export/csv.ts` och `test/helpers.ts`.

## Tidsantaganden

Pipelinen körs första gången 2026-10-01 07:00 svensk tid och med `raw_items_dag2.json` 2026-10-03 07:00.
Tidsstämplar utan tidszon tolkas som Europe/Stockholm.
