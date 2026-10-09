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

## AI-logg

- **2026-10-09, AI hade fel:** AI-verktyget skrev `package.json` med versioner ur minnet, och flera låg en till två huvudversioner efter. Upptäcktes vid installationen, och versionerna kontrollerades med `npm outdated`. Lärdom: kontrollera alltid versioner mot registret, lita inte på AI:ns minne.
- **2026-10-09, jag avvisade AI:ns förslag:** AI:n föreslog att `ovrigt` skulle bli standardkategori när modellen inte anger någon. Jag avvisade det, eftersom det upprepar mönstret i fel 4 (ett tyst standardvärde som ser ut som ett riktigt beslut). Artikeln skulle dessutom hamna i en kategori som ingen valt, och `deny_categories` skulle behandla den som det. Rätt beteende är att ett svar utan kategori är ogiltigt. Lärdom: AI:n föreslår gärna en mjuk standard för att slippa fel. Granska varje förslag om "standardvärde" mot fel 4.
- **2026-10-09, AI gissade:** innan specen fanns i repot gissade AI:n både kategorilistan och citatet "berikningen ger … kategori". Citatet stämde (specens avsnitt om berikning), men listan var påhittad. Den byttes mot en lista som bygger på specens avsnitt 1.
