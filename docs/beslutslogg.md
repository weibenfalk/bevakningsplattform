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

## 2026-10-09: Fel 8 – alla spårningsparametrar tas bort ur URL:en

**Problem:** `normalizeUrl` tog bort parametrar medan den itererade över `searchParams`. Då hoppas varannan parameter över, så `?utm_source=rss&utm_medium=feed` blev `?utm_medium=feed` och r03 räknades inte som samma kungörelse som r01.
**Beslut:** Nycklarna samlas först och tas bort efteråt. Mönstret är utökat med vanliga klick-id:n (`dclid`, `msclkid`, `yclid`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`) och är skiftlägesokänsligt. Namn som bara *börjar* som ett klick-id (till exempel `gclidx`) tas inte bort längre, bara `utm_`-prefixet är ett prefix. Övriga parametrar bevaras i sin ordning, och en tom frågesträng lämnas inte kvar.
**Alternativ:** Svartlista bara `utm_`. Det missar klick-id:n. Att ta bort alla parametrar skulle däremot förstöra länkar där innehållet beror på en parameter (`?id=5`).
**Kvarstår:** Listan är inte uttömmande. En ogiltig adress får `new URL` att kasta ett fel och stoppa körningen. Deduplicering av r01/d01 (samma URL) hör till klusterlogiken, som inte är byggd.
**Bevis:** Två av sex tester i `test/normalize-url.spec.ts` var röda och blev gröna.

## 2026-10-09: Teckenkodning och tidszoner vid inläsning

**Beslut:** Ett nytt förberedelsesteg (`src/pipeline/ingest.ts`) körs på varje råpost före triage, så att triage, entitetsmatchning och poäng ser rätt text och tid.
- **Teckenkodning (r20):** Text som innehåller `Ã` eller `Â` tolkas som UTF-8 lästa som Latin-1/Windows-1252 och avkodas om (`FÃ¶nster` → `Fönster`). Reparationen gäller bara om det blir giltig UTF-8. Korrekt text lämnas orörd. Text som ser felkodad ut men inte går att reparera flaggas för granskning (`Misstänkt felkodad text`) i stället för att publiceras som den är.
- **Tidszon (r21):** Tid utan tidszon tolkas som Europe/Stockholm (antagande i `CLAUDE.md`) och lagras som UTC. Tid med tidszon (`Z`, `±hh:mm`) behåller sin. Det görs med `Intl` utan nytt beroende.
- **Ogiltigt datum:** Det kraschar inte längre infogningen. Artikeln sparas med `published_at = null`, flaggas för granskning (`Ogiltigt datum: …`) och publiceras inte.
**Alternativ:** (a) Reparera i `csv`/JSON-inläsningen. Det finns ingen sådan inläsning, eftersom råposterna kommer in som objekt, så rätt plats är före pipelinen. (b) Ett beroende som `luxon` eller `date-fns-tz` för tidszoner. Det är mer yta, och `Intl` räcker. (c) Anta UTC för tid utan zon. Det är fel för ett svenskt flöde och ger fel dygn (r21 hamnade två timmar fel).
**Känd begränsning:** En lokal tid som inte finns (klockan hoppar framåt vid sommartidens start) eller som inträffar två gånger (när den slutar) får en av de två möjliga tolkningarna. Det är ovanligt i nyhetsflöden men finns. Reparationen känner bara igen UTF-8 som lästs som Latin-1 eller Windows-1252, inte andra kodningar.
**Bevis:** 22 tester i `test/ingest.spec.ts`. De var röda eftersom modulen saknades och är nu gröna. Bland dem testas r20 och r21 genom hela berikningen.

## 2026-10-09: Triage – ett ogiltigt svar släpper inte igenom något

**Problem:** `minScore` var 0 och ett fel gav poängen 0, så `0 >= 0` släppte igenom allt, vid trasigt svar och vid varje svar. Specen siktar på att cirka 700 råposter ska ge cirka 200 kandidater, men triage gallrade ingenting. Det blev 700 dyra berikningar i stället för cirka 35. Svaret parsades med `JSON.parse` (inte `extractJson`), och artikeltexten låg oavgränsad i prompten.
**Beslut:**
- `filter` returnerar `{ kept, dropped, unscored }`. En artikel utan giltig poäng hamnar i `unscored` och går **inte** vidare, och det loggas med id. Ett helt ogiltigt svar (inte JSON, inte en lista, fel längd) ger `unscored` för hela omgången. Enstaka ogiltiga poster i en giltig lista påverkar bara sig själva.
- En giltig poäng är ett ändligt tal mellan 0 och 100. Strängar (`"90"`), `null`, `NaN` och tal utanför intervallet är ogiltiga.
- Tröskeln är 40 (`TRIAGE_MIN_SCORE`). Den är **gissad och inte kalibrerad**. Ett tomt eller icke-numeriskt värde i miljön ger standardvärdet i stället för 0 (`Number('')` är 0 och skulle åter släppa igenom allt).
- Svaret parsas med `extractJson`. Artiklarna avgränsas som `<artikel nr="…">`, systemprompten säger att texten är data, och avgränsarna tas bort ur titel och text så att texten inte kan stänga avgränsningen (se r19).
- Stubben svarar triage med 50 för varje artikel. Den kan inte bedöma relevans, och 50 är över tröskeln, så demon visar flödet. Det gäller bara stubben.
**Alternativ:** (a) Låta ogiltiga artiklar gå vidare till berikning "för säkerhets skull". Det är exakt buggen: ett fel blir ett beslut. (b) Släppa dem tyst. Då försvinner nyheter utan spår. Därför loggas de, men de **försöks inte om**. Omförsök hör till AI-routern, som är medvetet bortvald. (c) Kasta ett fel och stoppa körningen. En dålig omgång ska inte stoppa resten.
**Kvarstår:** Tröskeln är inte kalibrerad. Ingen omrankning mot profiler finns (specens mellansteg, bortvalt). Artiklar utan giltig poäng försöks inte om automatiskt. Berikningens prompt avgränsar fortfarande artikeltexten utan att neutralisera avgränsaren (samma svaghet som triage hade).
**Bevis:** 16 tester i `test/triage.spec.ts` och två i `test/enrich.spec.ts` för pipelinen, plus `test/pipeline-config.spec.ts`. Elva äldre tester som lät samma falska AI svara på både triage och berikning fick `scriptedLlm` i `test/helpers.ts` (en AI som svarar olika per steg, som en riktig). Det var testunderlaget som ändrades och inget beteende.

## 2026-10-09: Stubben sätter påverkan efter nyckelord (gäller bara stubben)

**Beslut:** `StubProvider` sätter `impact` efter nyckelord, på samma sätt som arbetsytan: `konkurs`, `rotavdrag`, `arbetsmiljöverket` och `börsnotering` (som ordbörjan, utan hänsyn till skiftläge) ger 85, och allt annat 50. Demon använder dessutom den riktiga `DigestService` för förhandsvisningen (tröskel, sortering på brådska, andra källor), så att den visar ett utskick som ser ut som ett riktigt.
**Gäller bara stubben.** Det är en testersättare för modellen, och ingen bedömning och inget beteende i produktionskoden. Riktig påverkan sätts av modellen (0–100). Nyckelorden är valda för att demon ska bli begriplig och bör inte tolkas som en affärsregel. Stubbens triage ger 50 till allt av samma skäl.
**Alternativ:** (a) Behålla 50 för alla. Då hamnar nästan allt vid tröskeln och utskicket blir platt. (b) Slumpad påverkan. Då går varken demon eller testerna att upprepa.
**Vad demon visar nu (stubben, dag 1):** Kalle får 11 artiklar, Anna 5 och Mikael 17. Börsnoteringen (r11) når bara koncernledningen. r20 (efter reparerad teckenkodning) når Anna, r10, r14, r15 och r21 flaggas och når ingen.
**Det demon fortfarande avslöjar (kända problem, inte rättade här):**
- **r08** ("Mina bästa städtips", brus) når Anna och Mikael med poängen 65. Stubben ger den fönsterputs på ordet "fönster", och entitetsmatcharen träffar dessutom det egna varumärket Rena Fönster på "rena fönster" (falsk träff på vanliga ord). Entiteten väger 100. Det är rättat i fel 10 (se nästa poster).
- **r19** (promptinjektion och ett obekräftat rykte om konkurs) får poängen 79 och hamnar högt för Kalle, eftersom ordet "konkurs" ger hög påverkan. Det är precis risken som "verifiering av akutlarm mot en andra källa" (medvetet bortvalt) ska hantera.
- **r06** fick först bara fonsterputs. Det är rättat i nästa post (rotavdrag ger takvård i stubben).
**Bevis:** Sju tester i `test/enrich.spec.ts` ("Stubben: påverkan efter nyckelord").

## 2026-10-09: r06 (rotavdraget) når både takvård och fönsterputs

**Beslut:** `rotavdrag` är nu ett tak-nyckelord i stubben. Rotavdraget gäller takvård, och r06 nämner dessutom fönsterputs (rutavdraget), så artikeln får båda arbetsytorna och når både Kalle och Anna. Specens mål är inga missade regeländringar, och r06 hade tidigare bara fonsterputs.
**Gäller bara stubben.** En riktig modell avgör arbetsytan själv. Att nyckelordet är ett prefix gör att "Rotavdraget" träffar. Rutavdrag har inget eget nyckelord, och det behövs inte här eftersom texten innehåller "fönsterputs".
**Bevis:** Tre tester i `test/enrich.spec.ts` ("Stubben: rotavdrag gäller takvård (r06)"): arbetsytorna, åtkomst för alla tre användare och att artikeln kommer med i både Kalles och Annas utskick. De var röda och är gröna.

## 2026-10-09: Fel 10 – genitiv, Unicode-gränser och skiftlägeskänsliga alias

**Problem:** `matchEntities` använde `\b` och flaggan `i`. `\b` räknar å, ä och ö som icke-bokstäver, så gränserna blev fel. "Takvårdarnas" missades. Alias som också är vanliga ord gav falska träffar: "Rena fönster" i ett städtips (r08) träffade det egna varumärket Rena Fönster, som väger 100, och r08 hamnade högt i utskicket.
**Beslut:**
- **Unicode-medvetna ordgränser** (`(?<![\p{L}\p{N}])` och `(?![\p{L}\p{N}])` med flaggan `u`) i stället för `\b`. Å, ä och ö räknas som bokstäver.
- **Genitiv-s** är tillåtet efter alias: "Takvårdarnas" matchar Takvårdarna. Andra ändelser och sammansättningar ("Takvårdarnasson", "SuperTakvårdarna") matchar inte.
- **Alias matchas skiftlägeskänsligt.** "Rena fönster" träffar inte "Rena Fönster", och "klart glas" träffar inte "Klart Glas". **Domäner matchas oberoende av skiftläge**, eftersom de är gemener i praktiken ("Takvardarna.SE" ska träffa).
- Flera blanksteg eller en radbrytning inuti ett flerordsalias spelar ingen roll, och specialtecken i ett alias tolkas som text.
**Avvägningen:** Skiftlägeskänslighet kan missa ett varumärke som skrivs med gemener ("rikstak") eller bara med versaler ("RIKSTAK I KONKURS"). Vi valde att missa ibland hellre än att få falska träffar som höjer poängen och för in brus i utskicken, eftersom en falsk entitetsträff på ett eget eller bevakat varumärke väger tungt (vikt 100 för kritiska). Det finns också ett missat-fall för en bevakad konkurrent. Avvägningen bör omprövas när riktig data finns, och det finns två vägar framåt: en uttrycklig flagga per alias ("känsligt för skiftläge") i entitetsregistret, eller en andra signal (till exempel domänen eller organisationsnumret) som tillåter gemener.
**Alternativ:** (a) Skiftlägeskänsligt bara för alias som är vanliga ord. Det kräver en lista över vanliga ord eller en flagga per alias, och datamodellen har ingen. (b) Behålla skiftlägesokänsligt och acceptera brus. Det är problemet vi hade. (c) Ett beroende för språkhantering (stammar). Mer yta än problemet motiverar.
**Kvarstår:** Bara genitiv-s hanteras. Andra böjningar (till exempel plural eller bestämd form av ett vanligt ord) matchar inte. Ett varumärke som består av ett vanligt ord med stor bokstav först i en mening ("Klart glas är..." mot "Klart Glas") missas också.
**Bevis:** Sju av åtta nya tester i `test/entity-matcher.spec.ts` ("ordgränser och böjning") var röda och blev gröna. Det åttonde ("domäner oberoende av skiftläge") skyddar det som redan fungerade.

## 2026-10-09: Fel 11 – similarity räknar riktig cosinuslikhet (klustring saknas)

**Problem:** `similarity` antog att vektorerna hade längd 1 och returnerade skalärprodukten. Stubbens vektorer är ordräkningar och har inte längd 1, så produkten blev godtyckligt stor och orelaterade texter räknades som "samma story".
**Beslut:** `similarity` räknar riktig cosinuslikhet: skalärprodukten delad med produkten av längderna, begränsad till [-1, 1]. Den gäller alla vektorer och antar ingenting om längden, och det är det rätta även med en leverantör som lämnar ut normaliserade vektorer. En nollvektor, en tom vektor eller ett värde som inte är ett tal ger 0 i stället för NaN. Vektorer med olika längd kastar `RangeError`, eftersom de kommer från olika modeller och en tyst jämförelse vore meningslös. Medvetet **bara** likheten rättas här. Klustring byggs inte.
**Alternativ:** (a) Normalisera vektorerna vid skapandet (i `embed`). Då gäller rättningen bara de vektorer som vi själva skapar, inte de som kommer in från en leverantör. (b) Låta olika längd ge 0. Då döljs ett konfigurationsfel (bytt modell) som annars syns direkt.
**Kvarstår (viktigt):**
- **Klustring saknas.** Ingen kod sätter `cluster_id`, och `isSameStory` används ingenstans. Därför skickas samma story från flera källor som separata nyheter. Det gäller r16/r17 (samma story) och r01/r02, och r01/r03 har dessutom identisk text men hamnar inte i samma kluster. "Även:"-raden i mejlet (`sourcesByCluster`) är därför alltid tom i praktiken. Kod och tester för den finns, men inga artiklar delar kluster-id.
- **Tröskeln 0,92 är gissad.** Den är inte kalibrerad. Specen kräver att trösklar för dedupe och semantisk matchning kalibreras mot märkt data och aldrig gissas, med kriteriet **under 2 % felaktiga sammanslagningar**. Det finns ingen märkt data, och en felaktig sammanslagning döljer en nyhet för mottagaren, så den är dyrare än en missad sammanslagning.
- **Stubben kan inte bedöma betydelse.** Stubbens "embedding" är hashade ord. Med riktig cosinuslikhet ger r01/r03 (samma text) 1,000, men r01/r02 och r16/r17 (samma story med olika ordval) bara 0,463 och 0,647, långt under 0,92. Den ger alltså inga falska sammanslagningar, men heller inga rätta för olika formuleringar. Det går inte att kalibrera mot stubben.
**Nästa steg i överlämningen (i ordning):** (1) Bygg klustringen: sätt `cluster_id` vid berikning genom att jämföra mot artiklar de senaste dygnen. (2) Skaffa märkt data, till exempel par av nyheter som en redaktör har markerat som samma eller olika story, och kalibrera tröskeln så att felaktiga sammanslagningar blir under 2 %. (3) Byt stubben mot en riktig embeddingmodell innan kalibreringen, eftersom tröskeln beror på modellen.
**Bevis:** Sju av nio tester i `test/similarity.spec.ts` var röda och blev gröna. Fel 11-testet flyttades dit från `test/kanda-fel`.

## 2026-10-09: Inga kända fel kvar i `test/kanda-fel`

**Beslut:** `test/kanda-fel/kanda-fel.spec.ts` är borttagen, eftersom alla elva kända fel är rättade och flyttade till den vanliga sviten. `npm run test:kanda-fel` kör med `--passWithNoTests` och är grönt när mappen är tom. Nya kända fel som upptäcks senare ska få sitt röda test där först (regel 1 i `CLAUDE.md`).

## 2026-10-09: Dubbletter och idempotens – den normaliserade URL:en är identiteten

**Problem:** Artiklar var bara unika på `raw_id`. `normalizeUrl` (fel 8) rättades men användes bara när URL:en lagrades, aldrig för att kontrollera dubbletter. r01 och r03 (samma kungörelse, olika `utm_`-parametrar) och d01 (samma URL dag 2) blev tre separata artiklar, och kungörelsen kom med två gånger i utskicket. r09 förekommer två gånger med samma id men olika URL och olika text, och den andra försvann tyst i `onConflict('raw_id').ignore()`. En omkörning gjorde dessutom nya AI-anrop för poster som redan var sparade. Specens krav 7 (idempotens) gäller: varje jobb ska kunna köras om utan dubbletter.
**Beslut:**
- **Identiteten är den normaliserade URL:en.** `articles.url` är `UNIQUE` (och `raw_id` är kvar som unik). `raw_id` kommer från källan och har visat sig vara opålitligt.
- **Kontrollen görs före triage och berikning** (`src/pipeline/dedupe.ts`), mot databasen och mot tidigare poster i samma körning. En omkörning kostar därför inga AI-anrop. Den första posten vinner, oberoende av ordning.
- Varje post hamnar i en av fem kategorier:
  - **Ny:** går vidare.
  - **Redan sparad** (samma id, URL och innehåll): räknas i rapporten (`alreadyStored`) och loggas inte, eftersom det inte är någon avvikelse.
  - **`duplicate`:** samma URL och samma innehåll under ett annat id (r03, d01).
  - **`changed_content`:** samma URL men annat innehåll (d02 uppdaterar r02). Skrivs **inte** över.
  - **`raw_id_collision`:** samma id men en annan URL (r09).
  - **`invalid_url`:** URL:en går inte att tolka. Tidigare kraschade hela körningen.
- **Inget försvinner tyst.** Varje överhoppad post sparas i tabellen `skipped_items` med orsak, vilken artikel den krockade med och **hela råposten** (`payload`), och den returneras i rapporten från `EnrichService.run`. Tabellen är unik per (id, URL, orsak), så en omkörning dubblerar inte loggen. Det är den körningslogg som specens krav 7 efterfrågar för just det här steget.
- Innehåll jämförs med en hash (`articles.content_hash`) av titel och text och inte med själva texten. Då behöver kontrollen aldrig läsa `full_text`, och arkitekturtestet som skyddar fulltexten (fel 5) fortsätter betyda något. Hashen behövs också när uppdateringar byggs.
**Alternativ:** (a) Bara unik URL i databasen och `ON CONFLICT DO NOTHING`. Då tappas dubbletter och kollisioner tyst, och AI-anropen sker redan. (b) Ge den andra r09 ett nytt id och spara den som en egen artikel. Då skapar vi ett id som källan aldrig gav, och vi vet inte om de två är samma recension (de har olika URL:er, så troligen inte). Att logga hela posten ger samma möjlighet att köra om den senare, utan att gissa. (c) Låta den senaste vinna. Då skriver en trasig post över en bra, och uppdateringar blir osynliga. (d) Göra `raw_id` icke-unikt nu när URL:en är identiteten. Då kan den andra r09 sparas som en egen artikel bredvid den första, och `raw_id_collision` försvinner som kategori. **Det är ett öppet alternativ som vi inte valt än.** Det talar för att r09 är två olika dokument (olika URL och text), och att de då inte ska tappas. Det talar emot att `raw_id` används som nyckel på flera ställen (tester, demo, `skipped_items.existing_raw_id`) och att en källa som återanvänder ett id kan få olika dokument att se ut som ett. Det kräver också att allt som slår upp en artikel på `raw_id` byter nyckel. Vi valde att behålla `raw_id` unikt och logga hela posten tills vi vet om id-kollisionen är ett fel hos källan eller normalt beteende.

**Kvarstår:**
- **Uppdateringar tillämpas inte.** d02 (en uppdaterad version av r02) loggas som `changed_content` men skriver inte över artikeln. Det kräver ett beslut om vad en uppdatering ska göra (ersätta texten, räkna om poängen, markera som uppföljning) och hänger ihop med uppföljningsfaktorn (fel 20, ×0,60). **Beslutet tas när vi bygger körningen för dag 2.**
- **Rensningen efter 90 dagar saknas.** Specen säger att fulltext "lagras bara för bearbetning och rensas efter 90 dagar". `skipped_items.payload` innehåller hela råposter, alltså råtext, och måste omfattas av rensningen. Det gör `articles.full_text` också, och ingen av dem rensas i dag (fel 35). Rensningen ska vara ett jobb som är säkert att köra om (krav 7) och som loggar vad det tog bort. Raden i `skipped_items` kan behållas utan `payload` (id, orsak, tid), så att loggen över vad som hoppades över finns kvar när råtexten är borta. Det är en avvägning att besluta när jobbet byggs.
- Den andra r09 sparas som artikel först när id-problemet är löst. Posten ligger hel i `skipped_items`.
- **Samma story från olika källor** (r01/r02, r16/r17) är inte en URL-dubblett. Det är klustringen, som saknas (fel 29).
- En post som hoppas över som `duplicate` ger ingen ny källa i "Även:" under den första artikeln. Först med klustringen kan olika källor till samma story visas där.
**Bevis:** 12 tester i `test/dedupe.spec.ts`, alla med de riktiga posterna ur `data/`: r01/r03/d01 (dubbletter, båda ordningarna, en gång i utskicket, unikhet i databasen), omkörning (inga nya artiklar, loggrader eller AI-anrop), d02 (ändrat innehåll), r09 (kollision, även över två körningar), ogiltig URL och `utm_`/versaler/fragment.

## 2026-10-09: AI-leverantör

**Beslut:** Ingen riktig leverantör är inkopplad. Allt körs med stubben, enligt kraven. Vid val av leverantör är krav på databehandling inom EU och kostnad per anrop avgörande. Ett billigt alternativ för triagen och ett dyrare för berikningen, med en reservmodell från en annan leverantör.
**Hur en leverantör kopplas in:** Gränssnittet `LlmProvider` gör att en riktig leverantör kan kopplas in som en ny fil, utan att resten av koden ändras. Koden skiljer redan på triage och berikning (`task: 'triage'` respektive `'enrich'`), så olika modeller per steg kräver bara att leverantören väljer modell efter `task`.
**Hur leverantören väljs:**
> Jag skulle inte välja utifrån känsla. Jag skulle ta ett märkt testset med ett hundratal artiklar där vi vet rätt svar, och köra två eller tre kandidater mot det. Sedan mäter jag andelen korrekta bedömningar, falska träffar, giltiga svar och kostnad per utskick. Den som klarar kraven billigast vinner. Eftersom modellvalet ligger i konfiguration går det att byta senare.

Det är samma princip som specen kräver för trösklarna (kalibrering mot märkt data, aldrig gissning), och samma märkta data kan användas till båda. "Giltiga svar" mäts mot de scheman som redan finns (`EnrichmentSchema` och triagens poängintervall), så andelen giltiga svar går att räkna ut direkt.
**Obs:** Att modellvalet ligger i konfiguration gäller först när routern är byggd. I dag väljer `AppModule` leverantör (`{ provide: LLM, useClass: StubProvider }`), så ett byte är en ändring där och inte en inställning.
**Kvarstår:** Routern med modellval i konfiguration, reservmodell, omförsök, budgettak och kostnadsräkning är medvetet bortvald (se `CLAUDE.md`) och dokumenteras som nästa steg i `ÖVERLÄMNING.md`. Detsamma gäller embeddings och kalibrering av trösklar, som hänger på vilken modell som väljs (se fel 11).

## 2026-10-09: Webbserver och startskript (`main.ts`)

**Beslut:** `src/main.ts` startar `AppModule` med `NestFactory`, och `npm start` kör den. Porten är 3000 eller `PORT` (ett ogiltigt värde ger 3000). `bootstrap()` är exporterad så att ett test kan starta appen på en slumpad port.
- **Lyssnar bara på `127.0.0.1` som standard** (`HOST` ändrar det). Autentiseringen är en platshållare som litar på `x-user-id`, så en server som är nåbar utifrån låter vem som helst utge sig för vem som helst, inklusive en admin. Att binda till `0.0.0.0` som Nest gör som standard vore att öppna fel 18 för hela nätverket. README varnar för det.
- **`DATABASE_URL`:** variabeln används om den är satt. Utanför produktion faller servern tillbaka på den lokala Docker-databasen. I produktion (`NODE_ENV=production`) krävs variabeln, annars startar inte servern. Då kan servern aldrig tyst prata med fel databas.
- Curl-exempel för användare och admin, och varningen att `x-user-id` bara är en platshållare, står i README.
**Alternativ:** (a) Binda till alla adresser och förlita sig på brandväggen. Ett fel i nätverksinställningarna skulle då bli ett dataläckage. (b) Låta `DATABASE_URL` vara obligatorisk överallt. Det är säkrast men gör `npm start` onödigt krångligt lokalt, där ingen produktionsdata finns.
**En bugg som bara en riktig server visade:** `knexProvider` läste `process.env.DATABASE_URL`, men bara skripten (`scripts/db.ts`, som demon, migreringen och testhjälparna importerar) satte ett standardvärde. Med `npm start` fanns ingen anslutningssträng, och varje databasanrop gav 500. Testet som startade appen var grönt första gången, eftersom testhjälparna redan hade satt variabeln. Det upptäcktes först när servern kördes på riktigt och anropades med curl. Testet startar nu appen utan `DATABASE_URL`, och det var rött innan rättningen.
**Kvarstår:** Riktig inloggning (fel 18). Ingen graciös nedstängning: `knexProvider` stänger inte sin pool. Bara exporten är en HTTP-väg än. Sök, arkiv, API och utskick (specens krav på omfånget "överallt") har inga endpoints.
**Bevis:** `test/app.spec.ts` (10 tester) och `test/database-config.spec.ts` (3), plus curl mot `npm start`: 401 utan användare, 200 för Anna med bara fönsterputs, 403 när Anna anger Kalle, 200 för admin Mikael som Kalle, och 400 för `sort=(select pg_sleep(5))`.

## AI-logg

- **2026-10-09, AI hade fel:** AI-verktyget skrev `package.json` med versioner ur minnet, och flera låg en till två huvudversioner efter. Upptäcktes vid installationen, och versionerna kontrollerades med `npm outdated`. Lärdom: kontrollera alltid versioner mot registret, lita inte på AI:ns minne.
- **2026-10-09, jag avvisade AI:ns förslag:** AI:n föreslog att `ovrigt` skulle bli standardkategori när modellen inte anger någon. Jag avvisade det, eftersom det upprepar mönstret i fel 4 (ett tyst standardvärde som ser ut som ett riktigt beslut). Artikeln skulle dessutom hamna i en kategori som ingen valt, och `deny_categories` skulle behandla den som det. Rätt beteende är att ett svar utan kategori är ogiltigt. Lärdom: AI:n föreslår gärna en mjuk standard för att slippa fel. Granska varje förslag om "standardvärde" mot fel 4.
- **2026-10-09, AI gissade:** innan specen fanns i repot gissade AI:n både kategorilistan och citatet "berikningen ger … kategori". Citatet stämde (specens avsnitt om berikning), men listan var påhittad. Den byttes mot en lista som bygger på specens avsnitt 1.
- **2026-10-09, AI hade fel (arbetsyta för koncern):** En AI-assistent som jag använde för planering, utanför terminalen, föreslog först att AI:n i berikningen aldrig skulle få välja arbetsytan koncern, som skydd mot injektion. Felet upptäcktes vid genomgång innan något implementerades. Koncern gör bara en artikel synlig för koncernledningen, som redan ser allt. Den farliga riktningen är den motsatta: att koncerninnehåll (som r11, börsnoteringen) också får takvard eller fonsterputs och når fel personer. Ett förbud hade dessutom gjort att r11 inte nådde någon alls. Lärdom: analysera åt vilket håll ett fel läcker innan man väljer skydd.
- **2026-10-09, AI hade fel (testet gav falsk trygghet):** AI:n skrev ett test som startar appen och anropar exporten, och det var grönt direkt. Men testhjälparna sätter `DATABASE_URL` åt testet, så testet bevisade inte att `npm start` fungerar. När servern kördes på riktigt med curl gav varje anrop 500. Lärdom: ett test som delar miljö med det som ska testas bevisar inte mycket. Kör alltid det riktiga programmet också, och låt testet återskapa det riktiga läget (här: ingen `DATABASE_URL`).
