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

## 2026-10-09: Fel 1 – akuta nyheter går förbi arbetsytan

**Beslut:** Arbetsytan är en hård gräns, även för akuta händelser. `orWhere('urgency', 'akut')` är borttagen i `ArticleAccessService`.
**Alternativ:** (a) Behålla en bypass för akuta nyheter men begränsa den till användare med rätt roll. (b) Låta akuta nyheter gå igenom men dölja `full_text`. Båda bryter antagandet att arbetsytan är en hård gräns, och risken är redan inträffad: Anna fick en konkursnyhet om takvård.
**Varför:** `orWhere` gjorde att `urgency = 'akut'` räckte ensamt. Det förbigick också nekade entiteter och sökfiltret, eftersom AND binder hårdare än OR. Därför blev fel 2 grönt av samma ändring. Rättningen är medvetet minimal: fel 3 (`select('*')`) och SQL-injektionen via `sort` ligger i samma fil men tas som egna steg med egna tester. Om företaget vill att akuta nyheter ska nå fler än arbetsytan, ska det bli en uttrycklig regel i `ContentScopeService` och inte en bypass i frågan.
**Bevis:** Fel 1 och 2 gick från rött till grönt och är flyttade till `test/access.spec.ts`.

## 2026-10-09: Fel 3 – fulltext lämnar åtkomstmodulen, och sort är en vitlista

**Beslut:** `ArticleAccessService` väljer explicita kolumner (`PUBLIC_COLUMNS`) i stället för `select('*')`, så `full_text` och `search_vector` lämnar aldrig modulen. `sort` tolkas som `<kolumn> [asc|desc]` mot en vitlista (`relevance`, `published_at`, `impact`, `raw_id`, `id`). Standard är `relevance desc`, med `id` som sekundär sortering så att ordningen blir stabil.
**Alternativ:** (a) Behålla `select('*')` och ta bort fulltexten i varje anropare. Det bryter mot idén om en enda väg in, och en ny anropare glömmer lätt. (b) Falla tillbaka på standardsortering vid ogiltigt värde. Det döljer fel, så jag valde 400 (`BadRequestException`). (c) Bara parameterbinda sort. Kolumnnamn kan inte bindas i SQL, så en vitlista är det som fungerar.
**Varför:** `select('*')` var samma läcka som i incidenten. `orderByRaw(sort)` var SQL-injektion för alla inloggade via `/export/articles.csv?sort=`. Ingen anropare använder `full_text` via åtkomstmodulen, så ändringen bryter inget. Det som kvarstår i exporten är `?userId=`, som är en separat rättning.
**Bevis:** Två röda tester blev gröna och är flyttade till `test/access.spec.ts`.

## 2026-10-09: `deny_categories` gäller nu, och kategorin sätts av berikningen

**Beslut:**
- `ArticleAccessService` döljer artiklar vars `categories` överlappar användarens `deny_categories`, på samma sätt som för nekade entiteter. Det gäller alla anrop, även akuta artiklar och sökträffar.
- Kategorin sätts av berikningen (specen: "berikningen ger … kategori"). `EnrichmentSchema` validerar `categories` mot en fast lista (`CATEGORIES`). Ett värde utanför listan gör hela AI-svaret ogiltigt, och modellen kan alltså inte hitta på kategorier. Listan skickas också med i prompten.
- Kolumnen `articles.categories text[]` ligger i den första migrationen. Den separata migrationen är borttagen. Specen kräver att datamodellen finns från första migrationen, och migrationen har aldrig körts i produktion. Den lokala databasen återskapades med `db:down` och `db:up`. Bara testdata gick förlorad.

**Alternativ:** (a) Behålla den separata migrationen. Det ger en historik som inte motsvarar något som någonsin körts. (b) Härleda kategori ur andra fält. Det vore en gissning. (c) Låta en redaktör sätta kategorin. Specen pekar på berikningen.
**Kategorilistan:** `regler, makro, sasong, konkurrent, eget_varumarke, ovrigt`. Den bygger på specens avsnitt 1 (regler, makro, säsong, lokala konkurrenter). `eget_varumarke` och `ovrigt` finns inte i specen utan är våra tillägg. Värdena är nycklar utan å, ä och ö. Listan ersatte en provisorisk lista som jag gissat innan specen låg i repot. Specen anger bara att berikningen ger "kategori" (singular), men kolumnen är en lista och filtret fungerar för båda.
**Minst en kategori, ingen standard:** `categories` måste ha minst ett värde, annars är hela AI-svaret ogiltigt. Alternativet var att låta `ovrigt` vara standard när modellen inte anger något. Det avvisades, eftersom det upprepar fel 4: ett osäkert svar får inte tyst bli ett standardvärde som ser ut som ett riktigt beslut. En artikel utan kategori kan inte filtreras av `deny_categories` och skulle läcka. Ett ogiltigt svar följer samma väg som annat ogiltigt AI-svar. I dag är det en fallback till originaltexten (fel 5), som rättas separat så att artikeln inte publiceras. `ovrigt` är alltså ett val modellen gör, inte ett värde systemet fyller i.
**Kvarstående antagande:** Äldre rader med tom `categories` döljs inte av `deny_categories`. Nya rader får alltid minst en kategori. Stubben (`StubProvider`) svarar `ovrigt`, vilket är en testersättare för modellens svar och inget standardvärde i produktionskoden.
**Bevis:** `fel 12` och `fel 12b` gick från rött till grönt och är flyttade till `test/access.spec.ts`. Nya tester i `test/enrich.spec.ts` täcker validering mot listan, kravet på minst en kategori och lagring av kategorin.

## 2026-10-09: Fel 4 – ett AI-svar utan giltig arbetsyta publiceras inte (fail closed)

**Problem:** Om modellen inte angav `business_areas` fick artikeln standardvärdet `takvard` + `fonsterputs`. Stubben svarade alltid `[]`, så allt hamnade hos båda arbetsytorna, och det var en av tre orsaker till incidenten.
**Beslut (fail closed):**
- Standardvärdet är borttaget från `pipeline.config.ts`.
- `business_areas` valideras mot en fast lista (`SPACES`: koncern, takvard, fonsterputs) med **minst ett värde**, på samma sätt som kategorierna.
- Ett svar utan giltig arbetsyta är ogiltigt. Artikeln sparas då med `spaces = []`, `needs_review = true` och en `review_reason`. Den publiceras inte och når ingen användare.
- Åtkomstmodulen filtrerar dessutom `needs_review = false`, som ett andra skydd. Det räcker alltså inte att `spaces` råkar vara tom.
- Kolumnerna `needs_review` och `review_reason` ligger i den första migrationen (samma motivering som för `categories`).
- Fel får aldrig leda till att en artikel når fler. Det är principen för alla felvägar.

**Alternativ:**
1. *Standardvärde* (förra beteendet, eller ett annat som `koncern`). Det avvisades eftersom ett osäkert svar då blir ett tyst beslut som ser riktigt ut, och det är precis det som läckte. Ett annat standardvärde har samma problem.
2. *Förbjuda AI:n att ange `koncern`.* Det avvisades. `koncern` gör bara en artikel synlig för koncernledningen, som redan ser allt. Den farliga riktningen är att koncerninnehåll (till exempel r11, börsnoteringen) **också** får `takvard` eller `fonsterputs` och når fel personer. Ett förbud löser inte det, och det skulle dessutom göra att r11 inte når någon.
3. *Fail closed* (valt). Det enda alternativet där ett fel aldrig breddar spridningen.

**Stubben** är nu deterministisk (`stubBusinessAreas`): tak-ord ger `takvard`, fönster- och puts-ord ger `fonsterputs`, Sydkust och börsnotering ger `koncern`, och inget av dem ger tom lista, som då flaggas. Demon blir därmed meningsfull. I demon flaggades r10, r14, r15, r20 och r21, och en artikel (r08) släpptes felaktigt igenom:
- **r08** ("Rena fönster på tio minuter") matchar "fönster". Det är en falsk träff, och stubben kan inte bedöma sammanhang. Artikeln är brus men når Mikael och Anna.
- **r10** (pumpatävling) och **r15** (klart glas) är brus utan nyckelord. De ska flaggas, så det är rätt resultat.
- **r14** är på engelska ("Fonster" utan ö), så nyckelorden "fönster" och "puts" matchar inte.
- **r20** har trasig teckenkodning ("FÃ¶nster"). Det är en egen bugg i inläsningen som ska rättas, och inget fel i stubben.
- **r21** nämner Husfixarna (takvård) utan något tak-ord. Entitetskontrollen i nästa steg (se nedan) skulle fånga den.

Fail closed fungerade som tänkt: osäkra artiklar nådde ingen i stället för fel person.
**Känd risk som kvarstår:** En riktig modell kan felklassa en artikel, eller luras av en injektion som i r19, och ange en giltig men fel arbetsyta. Fail closed skyddar bara mot *ogiltiga* svar, inte mot *giltiga men felaktiga*.
**Nästa steg:** Kontrollera modellens arbetsyta mot deterministiska signaler, till exempel matchade entiteters affärsområde (`entities.space`) och källans arbetsyta. Vid motsägelse ska artikeln flaggas. Det kräver också ett redaktörsgränssnitt för flaggade artiklar, som i dag bara ligger kvar i databasen (medvetet bortvalt, se ÖVERLÄMNING).
**Rör inte:** Fel 5 (fallback till originaltexten i samma gren) är medvetet kvar till nästa steg. En ogiltig artikel sparas flaggad men har fortfarande originaltexten som `summary`.
**Bevis:** Fel 4 gick från rött till grönt och ligger nu i `test/enrich.spec.ts`, tillsammans med tester för valideringen och stubben. `test/access.spec.ts` har ett nytt test för att flaggade artiklar aldrig visas.

## 2026-10-09: Fel 5 – originaltexten används aldrig som sammanfattning

**Problem:** När AI-svaret var ogiltigt blev `summary = item.text.slice(0, 600)`. En kort artikel gick då ut i sin helhet, och det var en av incidentens tre orsaker.
**Beslut:** Ett ogiltigt svar ger `summary = null`, och artikeln är redan flaggad och dold sedan fel 4. `renderDigest` klarar `summary: null` (ingen text i stället för en krasch).
**Alternativ:** (a) Korta av texten ännu mer eller välja första meningen. Det är fortfarande originaltext, och upphovsrätt och läckage består. (b) Skriva en platshållare som "Sammanfattning saknas" i `summary`. Då blir ett fel ett värde som ser riktigt ut, vilket är mönstret i fel 4. `null` går inte att förväxla med en sammanfattning. (c) Försöka igen med en annan modell. Det är rätt på sikt (AI-routern, bortvald), men ändrar inte vad som får lagras när alla försök misslyckas.
**Granskning av andra vägar för råtext:**
- `full_text` skrivs bara av `EnrichService` (för att kunna granskas och köras om). Åtkomstmodulen väljer sedan fel 3 explicita kolumner och lämnar aldrig ut den.
- Mejlet (`DigestService` → `renderDigest`) får sina rader från åtkomstmodulen, och `renderDigest` skriver bara ut titel, url, sammanfattning och andra källor. Exporten skriver bara `id, title, url, relevance`.
- Tester: mejlet och exporten innehåller inte fulltexten, och ett arkitekturtest slår larm om någon annan fil än berikningen eller åtkomstmodulen nämner `full_text`. De flesta av dessa var redan gröna sedan fel 3. De är nu ett skydd mot regression.
- Kvarstår: `title` kommer från råposten och är inte validerad. `otherSources` läser fortfarande `articles` direkt (kodgranskningen, `digest.service.ts`). Titeln i mejlet escapas, men `summary` renderas fortfarande via `marked` (fel 6). `scripts/demo.ts` läser `full_text` direkt ur databasen för att visa läckan, och det är en diagnostikdel och ingen användarväg.
**Bevis:** Fel 5 gick från rött till grönt och ligger nu i `test/enrich.spec.ts`. `test/raw-text.spec.ts` är ny.

## 2026-10-09: Fel 6 och 7 – mejlet renderar bara escapad text och http(s)-länkar

**Beslut:** `marked` är borttaget (ur `package.json` och lockfilen). Sammanfattningen renderas som ren, escapad text, så Markdown tolkas aldrig. Huvudlänken och länkarna i `otherSources` går genom `safeHref`, som tolkar adressen med `new URL()` och bara släpper igenom `http:` och `https:`. Övriga adresser (`javascript:`, `data:`, relativa och ogiltiga) renderas inte som länk. Rubriken visas då som text, och en ogiltig länk i `otherSources` utelämnas. Värdet i `href` escapas dessutom.
**Alternativ:** (a) Behålla `marked` med sanering (till exempel DOMPurify). Det är mer kod och en beroendeyta i ett säkerhetskritiskt steg, och sammanfattningen behöver inte Markdown. (b) Svartlista farliga protokoll. Det missar nya, så vitlista är rätt väg. (c) `encodeURI` som tidigare. Den escapar inte rätt tecken för attribut.
**Bevis:** Fel 6 och 7 gick från rött till grönt och ligger i `test/render.spec.ts`, tillsammans med tester för versaler (`JaVaScRiPt:`), inledande mellanslag, `data:`, `//`-adresser och citattecken i adressen.

## 2026-10-09: `otherSources` går via åtkomstmodulen

**Problem:** `DigestService.otherSources` läste `articles` direkt förbi åtkomstmodulen. Man kunde se namn och länkar för källor från artiklar utanför sitt omfång, inklusive artiklar flaggade för granskning och nekade kategorier. Arkitekturtestet missade det, eftersom det bara söker efter `from articles`. Mejlet byggdes dessutom med `...a`, som spred hela raden.
**Beslut:** Ny metod `ArticleAccessService.sourcesByCluster(userId, clusterIds)` använder samma privata `scoped()` som `forUser`. Det finns alltså en enda uppsättning omfångsregler. Den hämtar källor för alla kluster i en fråga i stället för en fråga per artikel (N+1). `DigestService` har inte längre någon databasanslutning, och mejlets rader byggs fält för fält. Radtypen `ArticleRow` beskriver vad åtkomstmodulen lämnar ut.
**Alternativ:** Låta `DigestService` filtrera själv. Då dupliceras reglerna och nästa ändring glöms på ett ställe.
**Bevis:** Tre tester i `test/digest.spec.ts` var röda (hemlig, flaggad och nekad källa läckte) och blev gröna. Två gällande tester skyddar att egna källor syns och att artikeln inte räknas som sin egen andra källa.
**Kvarstår:** Arkitekturtestet fångar fortfarande inte `knex('articles')`. Det är nästa steg i planen. Tröskeln `>` (i stället för `>=`) och `slice` före `sort` i `DigestService` är ändrade i inget av stegen.

## 2026-10-09: Exporten – `?userId=` bara för admin, och skydd mot CSV-formler

**Beslut:**
- `?userId=` får bara användas av en admin. En vanlig användare som anger någon annans id får 403. Att ange sitt eget id går bra.
- Rollen sätts i `AuthGuard` och kommer från serverns konfiguration (`ADMIN_USER_IDS`, kommaseparerad lista), aldrig från anropet. Ingen header kan göra någon till admin. Utan konfiguration är ingen admin.
- Textceller i CSV som börjar med `=`, `+`, `-`, `@`, tabb eller radbrytning får ett inledande `'`. Tal lämnas orörda.
**Alternativ:** (a) En header som `x-user-role: admin`. Den kan vem som helst skicka. (b) Ta bort `?userId=` helt. Specen kräver att en admin kan visa systemet som en annan användare, så funktionen ska finnas men skyddas. (c) Prefixa alla celler. Det förstör siffror.
**Känd begränsning: riktig autentisering saknas.** `AuthGuard` är en platshållare från den ärvda koden. Den litar på headern `x-user-id`, så vem som helst kan utge sig för att vara en admin genom att skicka en admins id. Rollkontrollen är därför bara ett skydd mot misstag och mot enkla angrepp, och den skyddar inte mot en angripare. I produktion krävs riktig inloggning (till exempel OIDC med signerade tokens) och roller i identitetsleverantören. Det är första punkten under nästa steg i `ÖVERLÄMNING.md`. `sort` är redan en vitlista (fel 3).
**Bevis:** Nio tester i `test/export.spec.ts` var röda och blev gröna: rollkontroll i guarden (en roll i headern räknas inte), 403 för andras innehåll, admin får exportera, och sex fall av formelinjektion.

## 2026-10-09: `relevance` räknas ut i berikningen (score.ts kopplas in)

**Problem:** Ingen kod räknade ut `relevance`, så kolumnen var alltid tom. `DigestService` filtrerar på `relevance > 55`, och utskicket blev därför tomt. `score.ts` fanns men anropades aldrig.
**Beslut:** `EnrichService` räknar ut `relevance` med `score.ts` för varje giltig artikel och sparar den.
- **Källvikt** läses ur `data/sources.json` (`src/config/sources.ts`). En källa som saknas där kan inte poängsättas. Artikeln får då ingen poäng (`null`) och flaggas för granskning (`needs_review`) i stället för att få en gissad vikt. Det är samma princip som i fel 4: ett fel får aldrig bli ett värde som ser riktigt ut.
- **Färskhet** räknas mot en fast klocka (`src/config/clock.ts`, standard 2026-10-01 07:00 svensk tid, kan sättas med `PIPELINE_NOW`) och inte mot datorns klocka. Då går körningar att upprepa, och dag 2 kan köras med `run(items, now)`.
- **Entitetsvikt** kommer från den högst viktade matchade entiteten (`score.ts` tog tidigare den första). `EnrichService` matchar nu entiteter mot rubrik och text och sparar `entity_ids`. Tidigare sattes `entity_ids` aldrig, så `deny_entities` kunde inte träffa något i praktiken.
- En okänd bevakningsnivå väger 0 i stället för NaN. Ett ogiltigt datum ger ingen poäng och flaggas, i stället för att krascha infogningen.
**Alternativ:** (a) Standardvikt för okänd källa (till exempel 0,5). Det avvisades av samma skäl som standardvärdet i fel 4. (b) Räkna ut relevansen i en separat jobbsteg efter berikningen. Det ger fler rörliga delar utan vinst, eftersom alla indata finns vid berikningen. (c) Systemklockan. Då ändras poängen med tiden och körningarna går inte att jämföra.
**Kända begränsningar (får vänta, enligt beslut):**
- **Trendfaktorn** (×1,25) är inte inkopplad: `isTrending` är alltid `false`. `TrendService` räknar dessutom rader i stället för unika artiklar (fel 21).
- **Uppföljningsfaktorn** (×0,60) finns inte alls i formeln (fel 20).
- **Entitetsvikten är missvisande just nu.** Den bygger på `matchEntities`, som har öppna fel: tom alias eller domän matchar all text (fel 9), och böjningar missas (fel 10). Entiteterna Klart Glas och Rena Fönster har tom domän, och Rena Fönster är `critical`. Därför får i princip alla artiklar entitetsvikten 100 i demon, och `entity_ids` innehåller falska träffar. Det gäller även filtret för nekade entiteter. Fel 9 bör rättas före allt annat som beror på poängen. Entitetsimporten (fel 22) har också betydelse, eftersom nivån "Hög" ger vikt 0.
- Tröskeln i `DigestService` är `>` i stället för `>=`. Stubbens standardpoäng (impact 50) ger exakt 55 för en källa med vikt 2 och räknas därför bort.
- r21 saknar tidszon (fel 24), och `Date.parse` tolkar den då efter datorns tidszon.
**Bevis:** Nytt `test/score.spec.ts` (högst viktade entiteten, NaN, källvikt, färskhet) och fem tester i `test/enrich.spec.ts` (sparad relevans och icke-tomt utskick, källvikt, fast klocka, entitetsvikt med `entity_ids`, okänd källa). Alla var röda och är gröna.

## 2026-10-09: Fel 9 – tomma termer matchar inget

**Beslut:** `matchEntities` hoppar över alias och domäner som är tomma eller bara består av blanksteg. En tom term gav mönstret `\b\b`, som matchar all text. Därför fick varje artikel Klart Glas och Rena Fönster som entitet, med falsk entitetsvikt och falska `entity_ids` som följd (se "relevance räknas ut").
**Alternativ:** (a) Rensa bort tomma termer bara i entitetsimporten. Det behövs också (nästa steg), men matcharen får inte lita på att datan är ren, eftersom datan kan komma från andra vägar. (b) Kasta fel vid en tom term. Då stoppas hela matchningen för en dålig rad.
**Kvarstår:** Fel 10 (böjningar) och falska träffar på vanliga ord ("klart glas", "rena fönster") är inte rättade. De hör till en omskrivning av matcharen.
**Bevis:** Tre av fyra tester i `test/entity-matcher.spec.ts` var röda och blev gröna. Det fjärde skyddar att riktiga termer matchar.

## 2026-10-09: Entitetsimporten – validerad, ihopslagen och utan personuppgifter

**Beslut:** `EntityImportService.importCsv` returnerar en rapport (`imported`, `merged`, `rejected`, `mappings`) i stället för ett tal, och loggar allt som avvisas eller mappas.
- **Avvisas:** tomt namn, EXEMPEL-rader (namn som börjar med "EXEMPEL" eller anteckning "Exempelrad"), okänd bevakningsnivå, okänt affärsområde (mot `SPACES`) och okänd typ. Varje avvisad rad rapporteras med radnummer och orsak. Ingen rad försvinner tyst.
- **Mappas:** "Hög" (och kritisk/normal/låg) till `high` (och `critical`/`normal`/`low`). Varje mappning loggas med radnummer. Allt annat avvisas. Jag valde en liten fast mappning i stället för en gissning.
- **Trimning och dubbletter:** namn och termer trimmas. Rader med samma namn (utan hänsyn till skiftläge) slås ihop, och alias och domäner läggs ihop utan att något tappas. Mot databasen slås alias och domäner ihop med det som redan finns (inget skrivs över), och övriga fält uppdateras bara när den nya raden har ett värde.
- **Tomma termer** rensas bort, så att de inte når matcharen (se fel 9).
- **`meta_page_id` och `org_number` som text.** `cast` är avstängt. Id:t 9007199254740993 är större än `Number.MAX_SAFE_INTEGER` och blev tidigare ett avrundat tal.
- **Vd-namn lagras inte.** Kolumnen `ceo_name` är borttagen ur första migrationen (datasparsamhet: personuppgifter som systemet inte behöver, och som inte ska ligga i en databas utan skäl). Lokala databasen återskapades.
**Alternativ:** (a) Behålla kolumnen men lämna den tom. Då ligger risken kvar att någon fyller den. (b) Avvisa hela filen vid första felet. Då stoppar en dålig rad allt, och användaren får inte veta om resten. (c) Gissa en nivå för okända värden. Samma mönster som i fel 4.
**Kvarstår:** Organisationsnummer har olika format (556987-6543 mot 5564561234) och normaliseras inte. Typen `own_brand` styr ännu ingenting i pipelinen. `entities.id` är ett heltal men `entity_ids` på artiklar är text.
**Bevis:** Elva tester i `test/entity-import.spec.ts`, bland annat mot hela `data/entiteter.csv`: sju entiteter, två avvisade rader (rad 2 och 7), en ihopslagen dubblett och en mappning (rad 6).

## 2026-10-09: Utskicket – tröskel `>=` och sortering före begränsning

**Beslut:** `DigestService` tar med artiklar med relevans `>= 55` (tröskeln i `pipelineConfig`). Urvalet filtrerar, sorterar på brådska (akut först) och därefter relevans, och begränsar till `maxItems` sist.
**Varför:** Med `>` föll en artikel med exakt 55 bort, och stubbens standardpoäng blev just 55. Med `slice` före `sort` valde koden de 18 mest relevanta och sorterade dem sedan. En akut artikel med lägre poäng kunde alltså aldrig komma med, trots att brådskan styr ordningen i mejlet.
**Alternativ:** Behålla `>` som en medveten avgränsning. Det finns ingen sådan motivering i koden eller specen, och det var inte avsikten.
**Kvarstår:** Själva tröskeln (55) är gissad och inte kalibrerad (se "Medvetet bortvalt"). Åtkomstmodulens `limit` på 100 gäller före urvalet.
**Bevis:** Två av tre tester i `test/digest.spec.ts` ("urval") var röda och blev gröna. Det tredje skyddar ordningen inom samma brådska.

## AI-logg

- **2026-10-09, AI hade fel:** AI-verktyget skrev `package.json` med versioner ur minnet, och flera låg en till två huvudversioner efter. Upptäcktes vid installationen, och versionerna kontrollerades med `npm outdated`. Lärdom: kontrollera alltid versioner mot registret, lita inte på AI:ns minne.
- **2026-10-09, jag avvisade AI:ns förslag:** AI:n föreslog att `ovrigt` skulle bli standardkategori när modellen inte anger någon. Jag avvisade det, eftersom det upprepar mönstret i fel 4 (ett tyst standardvärde som ser ut som ett riktigt beslut). Artikeln skulle dessutom hamna i en kategori som ingen valt, och `deny_categories` skulle behandla den som det. Rätt beteende är att ett svar utan kategori är ogiltigt. Lärdom: AI:n föreslår gärna en mjuk standard för att slippa fel. Granska varje förslag om "standardvärde" mot fel 4.
- **2026-10-09, AI gissade:** innan specen fanns i repot gissade AI:n både kategorilistan och citatet "berikningen ger … kategori". Citatet stämde (specens avsnitt om berikning), men listan var påhittad. Den byttes mot en lista som bygger på specens avsnitt 1.
- **2026-10-09, AI hade fel (arbetsyta för koncern):** En AI-assistent som jag använde för planering, utanför terminalen, föreslog först att AI:n i berikningen aldrig skulle få välja arbetsytan koncern, som skydd mot injektion. Felet upptäcktes vid genomgång innan något implementerades. Koncern gör bara en artikel synlig för koncernledningen, som redan ser allt. Den farliga riktningen är den motsatta: att koncerninnehåll (som r11, börsnoteringen) också får takvard eller fonsterputs och når fel personer. Ett förbud hade dessutom gjort att r11 inte nådde någon alls. Lärdom: analysera åt vilket håll ett fel läcker innan man väljer skydd.
