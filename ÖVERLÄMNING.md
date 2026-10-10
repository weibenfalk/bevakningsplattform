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

Annat: `npm start` (servern på 127.0.0.1:3000, se README för exporten), `npm run query -- '<fråga>'` (visar hur en
profilfråga tolkas och vad den träffar), `npm run purge` (rensar fulltext äldre än 90 dagar), `npm run typecheck`.
Har du ändrat i migrationen: kör `npm run db:down` först, eftersom datamodellen ligger i en enda migration.

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
- Rensning av fulltext efter 90 dagar.

## Vad som inte fungerar, kända fel och risker

| Risk | Vad det innebär | Var |
|---|---|---|
| **Inloggningen är en platshållare** | `AuthGuard` litar på headern `x-user-id`. Vem som helst som når servern kan utge sig för att vara någon annan, även admin. Servern lyssnar därför bara på 127.0.0.1. Får inte exponeras innan riktig inloggning finns. | Fel 18 |
| **Allt körs mot stubben** | Stubben sätter arbetsyta och påverkan efter nyckelord. Poängen visar att flödet fungerar men är ingen bedömning. Ingen riktig AI är testad. | `src/llm/stub.provider.ts` |
| Obekräftade källor kan hamna högt | Ryktet r19 (“Rikstak i konkurs?!”) från ett forum får 79 poäng och kommer med i utskicket för takvård. Svaga källor (vikt under 1,0) kan inte längre skapa en trend, vilket sänkte r19 från 99. Men ett rykte kan fortfarande passera tröskeln. Gränsen 1,0 är inte kalibrerad. Den riktiga lösningen är verifiering mot en andra källa. | Fel 4b och 49 |
| **AI:n kan välja fel men giltig arbetsyta** | Valideringen stoppar ogiltiga svar, inte felaktiga. En modell som luras av injektionstext kan skicka en nyhet till fel arbetsyta. | Fel 4b |
| **Klustring saknas** | Samma story från flera källor (r01/r02, r16/r17) skickas som separata nyheter. Tröskeln för samma story är inte kalibrerad, och märkt data saknas. | Fel 29, 30 |
| **`ArticleAccessService` har blivit stor** | Cirka 300 rader: artiklar, utskicksloggen, trendräkning och profilträffar. Fungerar och är testad, men är svår att överblicka. | `src/access/` |
| **Frågetestaren saknas** | Profiler matchas bara mot nya artiklar, inte mot arkivet. En ny profil kan därför inte provas mot gammal data. | Beslutsloggen |
| **Delar av datamodellen används inte** | `memberships`, `visibility_exceptions`, `sections` och `subscriptions` finns men används inte. Omfånget styrs av `content_scopes`, profilerna läses in från `data/profiles.json` vid varje körning och synligheten per profil tillämpas inte. En förvald publikation används. | Datamodellen |
| **Inga riktiga mejl** | Utskicket sparas och renderas till `out/`, men skickas inte. Plaintextversion, dark mode och avregistreringslänk saknas. | `src/digest/` |
| **Prestandakraven är inte mätta** | Inget av kraven i specens avsnitt 10 (till exempel arkivsök under 800 ms) är mätt. | – |

## Nästa steg, i ordning

**1. Gör det som finns användbart och säkert.**
Riktig inloggning (till exempel företagets SSO) och rollerna från datamodellen i bruk. Dela upp åtkomstmodulen i flera
tjänster inom `src/access/` (artiklar, utskick, statistik), med samma arkitekturtest. Bygg klustring när märkt data
finns att kalibrera mot.
*Varför först:* ett system som kan läcka data eller skickar samma story tre gånger blir inte bättre av fler funktioner.

**2. Riktig AI och riktiga utskick.**
En riktig leverantör bakom `LlmProvider`, via en router med modellval i konfiguration, reservmodell, omförsök och
kostnadsräkning. Budgettak per leverantör och dygn. Hallucinationsskydd (tal i sammanfattningen måste finnas i
källtexten). Verifiering av akutlarm mot en andra källa, vilket också löser r19-risken. Välj leverantör genom att köra
två eller tre kandidater mot ett märkt testset (krav: data inom EU, bra svenska, under 60 kronor per utskick). Sedan
riktiga mejl via en mejltjänst, och publikationer och prenumerationer i bruk.
*Varför före insamlingen:* det går att bygga och mäta med testdatan som finns. Insamlingen kräver mer arbete och juridiska
överväganden.

**3. Riktig insamling.**
En basklass för källor med robots.txt och högst en förfrågan per två sekunder per domän, och en adapter per källtyp
(RSS, JSON, HTML, PDF, kungörelser, recensioner, platsannonser). Övervakning av källhälsa, så att en tyst källa syns.
Schemaläggning av pipelinen och av rensningen. Adaptrarna behöver bara leverera `RawItem`, resten av kedjan är oförändrad.
*Varför här:* det är den största delen, och den är meningslös innan steg 1 och 2 gör resultatet säkert och bra.

**4. Verktyg för redaktörer och admin.**
Frågetestaren mot arkivet (under 2 sekunder mot 30 dagar), redaktionell arbetsyta för att godkänna en utgåva,
"visa som annan användare", arkiv och sök, larmmotor och feedback.
*Varför sist:* verktygen bygger på att allt ovan fungerar.

Löpande: mät prestandakraven och målen i specen (inga missade regeländringar, under 20 procent falska träffar i
konkurrentbevakningen, under 60 kronor per utskick). Det kräver märkt data, och det bör finnas tidigt.

## Bra att veta

- Klockan är fast, så att körningar går att upprepa: dag 1 är 2026-10-01 07:00 (`src/config/clock.ts`, kan sättas med
  `PIPELINE_NOW`), och demon kör dag 2 med 2026-10-03 07:00. I produktion byts den mot systemklockan.
- Testdatan innehåller medvetna fällor. Varje råpost testar något, se "Fällor i testdatan" i `docs/kodgranskning.md`.
- Två av profilerna i `data/profiles.json` är medvetet trasiga och hoppas över med ett felmeddelande.
- `CLAUDE.md` innehåller arbetsreglerna som användes med AI-verktyget. Följ dem, särskilt "test först" och "uppdatera
  statustabellen".
