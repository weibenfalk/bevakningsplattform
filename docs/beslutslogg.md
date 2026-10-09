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

## AI-logg

- **2026-10-09, AI hade fel:** AI-verktyget skrev `package.json` med versioner ur minnet, och flera låg en till två huvudversioner efter. Upptäcktes vid installationen, och versionerna kontrollerades med `npm outdated`. Lärdom: kontrollera alltid versioner mot registret, lita inte på AI:ns minne.
- **2026-10-09, jag avvisade AI:ns förslag:** AI:n föreslog att `ovrigt` skulle bli standardkategori när modellen inte anger någon. Jag avvisade det, eftersom det upprepar mönstret i fel 4 (ett tyst standardvärde som ser ut som ett riktigt beslut). Artikeln skulle dessutom hamna i en kategori som ingen valt, och `deny_categories` skulle behandla den som det. Rätt beteende är att ett svar utan kategori är ogiltigt. Lärdom: AI:n föreslår gärna en mjuk standard för att slippa fel. Granska varje förslag om "standardvärde" mot fel 4.
- **2026-10-09, AI gissade:** innan specen fanns i repot gissade AI:n både kategorilistan och citatet "berikningen ger … kategori". Citatet stämde (specens avsnitt om berikning), men listan var påhittad. Den byttes mot en lista som bygger på specens avsnitt 1.
- **2026-10-09, AI hade fel (arbetsyta för koncern):** En AI-assistent som jag använde för planering, utanför terminalen, föreslog först att AI:n i berikningen aldrig skulle få välja arbetsytan koncern, som skydd mot injektion. Felet upptäcktes vid genomgång innan något implementerades. Koncern gör bara en artikel synlig för koncernledningen, som redan ser allt. Den farliga riktningen är den motsatta: att koncerninnehåll (som r11, börsnoteringen) också får takvard eller fonsterputs och når fel personer. Ett förbud hade dessutom gjort att r11 inte nådde någon alls. Lärdom: analysera åt vilket håll ett fel läcker innan man väljer skydd.
