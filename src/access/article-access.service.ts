import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { ScoreBreakdown } from '../pipeline/score';
import { SPACES, Urgency } from '../types';
import { ContentScope, ContentScopeService } from './content-scope.service';

export interface ArticleQuery {
  q?: string;
  sort?: string;
  limit?: number;
  /** Bara artiklar som användaren inte redan fått i ett utskick. */
  unsentOnly?: boolean;
  /** Bara rättelser. */
  onlyCorrections?: boolean;
  /** Lägsta relevans (artiklar utan poäng räknas som 0). */
  minRelevance?: number;
}

const DEFAULT_PUBLICATION = 'bevakning';

/** Det dubblettkontrollen behöver veta om en sparad artikel. Ingen text. */
export interface StoredIdentity {
  id: number;
  raw_id: string;
  url: string;
  content_hash: string | null;
  /** Tiden för den version som är sparad, för att avgöra om en post med samma URL är nyare eller äldre. */
  published_at: Date | null;
  updated_at: Date | null;
}

/** En artikelrad så som den lämnar åtkomstmodulen. Ingen fulltext. */
export interface ArticleRow {
  id: number;
  raw_id: string;
  url: string;
  source_name: string | null;
  title: string;
  summary: string | null;
  spaces: string[];
  urgency: string;
  impact: number | null;
  confidence: number | null;
  relevance: number | null;
  /** Uppdelningen av poängen, sparad när poängen räknades ut. `null` för artiklar utan poäng. Ingen text. */
  score_breakdown: ScoreBreakdown | null;
  cluster_id: string | null;
  entity_ids: string[];
  categories: string[];
  published_at: Date | null;
  /** Uppdaterad av källan efter första publiceringen: det här är en uppföljning. */
  is_followup: boolean;
  /** Rättelse: ska alltid med i utskicket. */
  is_correction: boolean;
  updated_at: Date | null;
}

/**
 * Kolumner som får lämna åtkomstmodulen. Lista uttryckligen, aldrig `select('*')`:
 * en ny kolumn (t.ex. `full_text`) ska inte läcka förrän någon valt det.
 */
const PUBLIC_COLUMNS = [
  'id', 'raw_id', 'url', 'source_name', 'title', 'summary', 'spaces', 'urgency',
  'impact', 'confidence', 'relevance', 'score_breakdown', 'cluster_id', 'entity_ids', 'categories', 'published_at',
  'is_followup', 'is_correction', 'updated_at',
] as const;

/** Kolumner som sorteringen får använda. Värdet från anroparen når aldrig SQL som text. */
const SORTABLE_COLUMNS: ReadonlySet<string> = new Set(['relevance', 'published_at', 'impact', 'raw_id', 'id']);

function parseSort(sort: string | undefined): { column: string; order: 'asc' | 'desc' } {
  if (sort === undefined || sort.trim() === '') return { column: 'relevance', order: 'desc' };
  const [column, direction, ...rest] = sort.trim().split(/\s+/);
  const order = (direction ?? 'asc').toLowerCase();
  if (!SORTABLE_COLUMNS.has(column) || rest.length || (order !== 'asc' && order !== 'desc')) {
    throw new BadRequestException(`Ogiltig sortering. Tillåtna kolumner: ${[...SORTABLE_COLUMNS].join(', ')}`);
  }
  return { column, order };
}

/** Texten som en fråga provas mot i `matchWholeArchive`. Lämnar aldrig metoden. */
export interface ArchiveText {
  title: string;
  /** Originaltexten, eller sammanfattningen när originaltexten är rensad. */
  body: string;
}

/** Varför en artikel inte syns för en användare. `article` är det hos artikeln som avgör, `user` det hos användarens omfång. */
export interface HiddenReason {
  code: 'space' | 'deny_category' | 'deny_entity' | 'deny_source' | 'allow_category' | 'allow_entity' | 'allow_source' | 'urgency' | 'unknown';
  article: string[];
  user: string[];
}

export interface ArchiveMatch {
  row: ArticleRow;
  terms: string[];
  /** Vilken text som matchades: originaltexten, eller sammanfattningen när originaltexten är rensad (efter 90 dagar). */
  textSource: 'fulltext' | 'summary';
  /** Skulle användaren få se artikeln? Avgörs av samma villkor som all annan läsning (`scoped`). */
  visible: boolean;
  /** Tom när artikeln syns. */
  hiddenReasons: HiddenReason[];
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x));

/**
 * Förklarar varför omfånget döljer en artikel. Bara en förklaring: om artikeln syns eller inte avgörs av
 * `scoped()`, aldrig av den här funktionen. Hittar den ingen orsak för en dold artikel blir svaret `unknown`
 * (hellre en ärlig lucka än en påhittad orsak).
 */
function explainHidden(scope: ContentScope, a: ArticleRow): HiddenReason[] {
  const reasons: HiddenReason[] = [];
  const add = (code: HiddenReason['code'], article: string[], user: string[]) => reasons.push({ code, article, user });
  if (!overlap(a.spaces, scope.spaces).length) add('space', a.spaces, scope.spaces);
  const deniedCategories = overlap(a.categories, scope.denyCategories);
  if (deniedCategories.length) add('deny_category', deniedCategories, []);
  const deniedEntities = overlap(a.entity_ids, scope.denyEntities);
  if (deniedEntities.length) add('deny_entity', deniedEntities, []);
  if (a.source_name !== null && scope.denySources.includes(a.source_name)) add('deny_source', [a.source_name], []);
  if (scope.allowCategories.length && !overlap(a.categories, scope.allowCategories).length) add('allow_category', a.categories, scope.allowCategories);
  if (scope.allowEntities.length && !overlap(a.entity_ids, scope.allowEntities).length) add('allow_entity', a.entity_ids, scope.allowEntities);
  if (scope.allowSources.length && !(a.source_name !== null && scope.allowSources.includes(a.source_name))) {
    add('allow_source', a.source_name === null ? [] : [a.source_name], scope.allowSources);
  }
  if (scope.visibleUrgencies && !scope.visibleUrgencies.includes(a.urgency as Urgency)) add('urgency', [a.urgency], scope.visibleUrgencies);
  return reasons.length ? reasons : [{ code: 'unknown', article: [], user: [] }];
}

/** Den enda vägen in till artiklar. All läsning ska gå härigenom. */
@Injectable()
export class ArticleAccessService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly scopes: ContentScopeService,
  ) {}

  /** Villkoren som alltid gäller: arbetsytan, tillåtna och nekade kategorier, källor och entiteter, högsta brådska och inga flaggade artiklar. */
  private scoped(scope: ContentScope): Knex.QueryBuilder {
    // Arbetsytan är en hård gräns, även för akuta händelser (specens avsnitt 2). Lägg aldrig till en
    // orWhere här: den skulle förbigå alla filter som läggs på nedan.
    const query = this.knex('articles')
      .where('spaces', '&&', scope.spaces)
      .where('needs_review', false);

    if (scope.denyEntities.length) {
      query.whereNot('entity_ids', '&&', scope.denyEntities);
    }
    if (scope.denyCategories.length) {
      query.whereNot('categories', '&&', scope.denyCategories);
    }
    // Nekade källor: en artikel utan källa kan inte träffas av en nekad källa, därför IS NULL OR.
    if (scope.denySources.length) {
      query.whereRaw('(source_name IS NULL OR NOT (source_name = ANY(?)))', [scope.denySources]);
    }
    // Tillåtelselistor (tom lista = ingen begränsning). Läggs till med AND, så nekat ovan vinner alltid.
    // En artikel som saknar källa, kategori eller entitet släpps inte in av en icke-tom lista.
    if (scope.allowCategories.length) query.where('categories', '&&', scope.allowCategories);
    if (scope.allowEntities.length) query.where('entity_ids', '&&', scope.allowEntities);
    if (scope.allowSources.length) query.whereIn('source_name', scope.allowSources);
    if (scope.visibleUrgencies) query.whereIn('urgency', scope.visibleUrgencies);
    return query;
  }

  async forUser(userId: string, opts: ArticleQuery = {}): Promise<ArticleRow[]> {
    const { column, order } = parseSort(opts.sort);
    const scope = await this.scopes.get(userId);

    const query = this.scoped(scope);
    if (opts.q) {
      query.andWhereRaw(`search_vector @@ websearch_to_tsquery('swedish', ?)`, [opts.q]);
    }

    if (opts.unsentOnly) {
      query.whereNotExists(
        this.delivered().whereRaw('di.article_id = articles.id').where('d.user_id', userId),
      );
    }
    if (opts.onlyCorrections) query.where('is_correction', true);
    if (opts.minRelevance !== undefined) query.where('relevance', '>=', opts.minRelevance);

    return query
      .select(PUBLIC_COLUMNS as unknown as string[])
      .orderBy([{ column, order }, { column: 'id', order: 'asc' }])
      .limit(opts.limit ?? 100) as unknown as Promise<ArticleRow[]>;
  }

  /**
   * Frågetestaren (admin): provar en fråga mot HELA arkivet (alla artiklar som inte är flaggade för granskning), med
   * samma text som profilmatchningen såg (rubrik och originaltext), eller rubrik och sammanfattning när originaltexten
   * är rensad. För varje träff anges om `userId` skulle få se artikeln, och annars varför inte.
   *
   * Den här metoden har medvetet inget användaromfång på urvalet, så den får bara anropas från kod som redan har
   * kontrollerat att anroparen är admin (`AdminGuard`). Omfånget används bara för att märka träffarna. En redaktör
   * skulle i en riktig version bara få träffar inom sin egen behörighet.
   *
   * Det är den enda metod som läser originaltexten (uttalat undantag i `test/raw-text.spec.ts`: specen tillåter
   * originaltexten för bearbetning i 90 dagar, men förbjuder att den visas eller skickas ut). Texten ges bara till
   * `match`, som svarar med de termer som träffade (eller `null`), och den ingår aldrig i det som returneras.
   */
  async matchWholeArchive(
    userId: string,
    match: (text: ArchiveText, row: ArticleRow) => string[] | null,
    limit = 5000,
    /** Bara de här artiklarna (till exempel de som kom med i en körning). */
    onlyIds?: number[],
  ): Promise<{ hits: ArchiveMatch[]; searched: number; withoutFullText: number }> {
    const scope = await this.scopes.get(userId);
    const rows: (ArticleRow & { full_text: string | null })[] = await this.knex('articles')
      .where('needs_review', false)
      .modify((q) => { if (onlyIds) q.whereIn('id', onlyIds); })
      .select([...PUBLIC_COLUMNS, 'full_text'] as unknown as string[])
      .orderBy([{ column: 'relevance', order: 'desc' }, { column: 'id', order: 'asc' }])
      .limit(limit);

    const found: Omit<ArchiveMatch, 'visible' | 'hiddenReasons'>[] = [];
    let withoutFullText = 0;
    for (const { full_text: fullText, ...row } of rows) {
      const purged = !fullText;
      if (purged) withoutFullText++;
      const terms = match({ title: row.title, body: purged ? (row.summary ?? '') : fullText }, row);
      if (terms) found.push({ row, terms, textSource: purged ? 'summary' : 'fulltext' });
    }

    // Vad användaren får se avgörs av samma villkor som all annan läsning, inte av förklaringen.
    const visibleIds = new Set<number>(
      found.length ? await this.scoped(scope).whereIn('id', found.map((f) => f.row.id)).pluck('id') : [],
    );
    const hits = found.map((f) => {
      const visible = visibleIds.has(f.row.id);
      return { ...f, visible, hiddenReasons: visible ? [] : explainHidden(scope, f.row) };
    });
    return { hits, searched: rows.length, withoutFullText };
  }

  /**
   * Identiteten (id, URL, innehållshash och tid) hos redan sparade artiklar, för dubblettkontrollen i pipelinen
   * (krav 7). Medvetet utan användaromfång: dubbletter och uppdateringar måste upptäckas oavsett vem som får se
   * artikeln. Därför lämnar den ingen text, och den används aldrig för att visa något för en användare.
   */
  async storedIdentities(urls: string[], rawIds: string[]): Promise<StoredIdentity[]> {
    return this.knex('articles')
      .whereIn('url', urls)
      .orWhereIn('raw_id', rawIds)
      .select('id', 'raw_id', 'url', 'content_hash', 'published_at', 'updated_at');
  }

  /** Skickade leveranser: leveransposter som hör till en leverans som har skickats (`sent_at`). Ett utkast räknas inte. */
  private delivered(): Knex.QueryBuilder {
    return this.knex('delivery_items as di').join('deliveries as d', 'd.id', 'di.delivery_id').whereNotNull('d.sent_at');
  }

  /**
   * Utskicksloggen: spara att artiklarna skickats till användaren, i utgåvan för den här sändningstiden
   * (`editions`), som en leverans till användaren (`deliveries`) med artiklarna som poster (`delivery_items`).
   * Mottagare i samma utskick delar utgåva. Säkert att köra om med samma sändningstid: inget dubbleras.
   * Loggen är det som hindrar att samma artikel skickas igen, och det som visar att en story redan funnits i ett utskick.
   *
   * Publikationer byggs inte än. Tills dess används en förvald publikation, och en användare som saknas i `users`
   * läggs till med lägsta rollen (platshållare tills användare läses in på riktigt).
   */
  async recordSent(userId: string, articleIds: number[], sentAt: Date): Promise<void> {
    if (!articleIds.length) return;
    await this.knex.transaction(async (trx) => {
      await trx('users').insert({ id: userId, name: userId, role: 'reader' }).onConflict('id').ignore();
      await trx('publications')
        .insert({ id: DEFAULT_PUBLICATION, name: 'Bevakning', spaces: [...SPACES], schedule: 'varannan dag' })
        .onConflict('id')
        .ignore();

      const [edition]: { id: number }[] = await trx('editions')
        .insert({ publication_id: DEFAULT_PUBLICATION, status: 'sent', sent_at: sentAt })
        .onConflict(['publication_id', 'sent_at'])
        .merge(['status'])
        .returning('id');
      const [delivery]: { id: number }[] = await trx('deliveries')
        .insert({ edition_id: edition.id, user_id: userId, sent_at: sentAt })
        .onConflict(['edition_id', 'user_id'])
        .merge(['sent_at'])
        .returning('id');
      await trx('delivery_items')
        .insert(articleIds.map((article_id) => ({ delivery_id: delivery.id, article_id })))
        .onConflict(['delivery_id', 'article_id'])
        .ignore();
    });
  }

  /** Vilka av artiklarna användaren redan fått i ett utskick. */
  async sentTo(userId: string, articleIds: number[]): Promise<Set<number>> {
    if (!articleIds.length) return new Set();
    const rows: { article_id: number }[] = await this.delivered()
      .where('d.user_id', userId)
      .whereIn('di.article_id', articleIds)
      .distinct('di.article_id as article_id');
    return new Set(rows.map((r) => r.article_id));
  }

  /**
   * Vilka av artiklarna som skickats till någon, för uppföljningsfaktorn. Medvetet utan användaromfång, och bara ett ja
   * eller nej per artikel: ingen får veta vem som fått vad.
   */
  async sentToAnyone(articleIds: number[]): Promise<Set<number>> {
    if (!articleIds.length) return new Set();
    const rows: { article_id: number }[] = await this.delivered()
      .whereIn('di.article_id', articleIds)
      .distinct('di.article_id as article_id');
    return new Set(rows.map((r) => r.article_id));
  }

  /**
   * Antal UNIKA artiklar som nämner en entitet och publicerades i fönstret (`since` till `until`), för trendberäkningen.
   * Räknar artiklar (en rad per artikel i `articles`), inte träffrader, och på publiceringstiden, inte på när raden
   * sparades. Bara artiklar från `sourceIds` räknas (trenden ska inte kunna skapas av källor med låg vikt). Artikeln `excludeArticleId` räknas inte (en uppdatering ska inte räkna sig själv). Medvetet utan
   * användaromfång: det är en siffra över hela systemet och ingen artikel lämnar modulen.
   */
  async countArticlesAboutEntity(entityId: string, since: Date, until: Date, sourceIds: string[], excludeArticleId?: number): Promise<number> {
    const query = this.knex('articles')
      .whereRaw('entity_ids @> ARRAY[?]::text[]', [entityId])
      .andWhere('published_at', '>=', since)
      .andWhere('published_at', '<=', until)
      .whereIn('source_name', sourceIds);
    if (excludeArticleId !== undefined) query.whereNot('id', excludeArticleId);
    const row = await query.count<{ count: string }>('* as count').first();
    return Number(row?.count ?? 0);
  }

  /**
   * Av de angivna artiklarna, de som användaren får se. Används av profilmatchningen, så att en profil
   * bara matchar inom ägarens omfång. Ingen fulltext.
   */
  async visibleAmong(userId: string, articleIds: number[]): Promise<ArticleRow[]> {
    if (!articleIds.length) return [];
    const scope = await this.scopes.get(userId);
    return this.scoped(scope)
      .whereIn('id', articleIds)
      .select(PUBLIC_COLUMNS as unknown as string[])
      .orderBy('id') as unknown as Promise<ArticleRow[]>;
  }

  /**
   * Vilka av användarens EGNA profiler som träffade artiklarna, och med vilka termer. Bara träffar av profilens
   * senaste version, och bara artiklar inom användarens omfång. Andras profiler lämnas aldrig ut.
   */
  async profileMatchesForUser(
    userId: string,
    articleIds: number[],
  ): Promise<Map<number, { profileId: string; terms: string[] }[]>> {
    const result = new Map<number, { profileId: string; terms: string[] }[]>();
    if (!articleIds.length) return result;
    const scope = await this.scopes.get(userId);
    const rows: { article_id: number; profile_id: string; term: string }[] = await this.knex('profile_matches as m')
      .join('profiles as p', 'p.id', 'm.profile_id')
      .where('p.owner_id', userId)
      .whereIn('m.article_id', articleIds)
      .whereIn('m.article_id', this.scoped(scope).select('id'))
      .whereRaw('m.profile_version = (select max(version) from profile_versions where profile_id = m.profile_id)')
      .select('m.article_id', 'm.profile_id', 'm.term')
      .orderBy(['m.article_id', 'm.profile_id', 'm.term']);
    for (const r of rows) {
      const list = result.get(r.article_id) ?? [];
      const last = list[list.length - 1];
      if (last?.profileId === r.profile_id) last.terms.push(r.term);
      else list.push({ profileId: r.profile_id, terms: [r.term] });
      result.set(r.article_id, list);
    }
    return result;
  }

  /**
   * Vilka artiklar (raw_id) användarens EGNA profiler träffade: totalt (senaste versionen, inom användarens omfång),
   * och de som sparades efter `since` (starten på den senaste profilkörningen). Artiklar, inte termer.
   */
  async profileMatchedArticlesForUser(userId: string, since: Date | null): Promise<Map<string, { total: string[]; sinceRun: string[] }>> {
    const scope = await this.scopes.get(userId);
    const rows: { profile_id: string; raw_id: string; created_at: Date }[] = await (this.knex('profile_matches as m')
      .join('profiles as p', 'p.id', 'm.profile_id')
      .join('articles as a', 'a.id', 'm.article_id')
      .where('p.owner_id', userId)
      .whereIn('m.article_id', this.scoped(scope).select('id'))
      .whereRaw('m.profile_version = (select max(version) from profile_versions where profile_id = m.profile_id)')
      .select('m.profile_id', 'a.raw_id')
      .max('m.created_at as created_at')
      .groupBy('m.profile_id', 'a.raw_id')
      .orderBy(['m.profile_id', 'a.raw_id']) as unknown as Promise<typeof rows>);
    const result = new Map<string, { total: string[]; sinceRun: string[] }>();
    for (const r of rows) {
      const entry = result.get(r.profile_id) ?? { total: [], sinceRun: [] };
      entry.total.push(r.raw_id);
      if (since && r.created_at >= since) entry.sinceRun.push(r.raw_id);
      result.set(r.profile_id, entry);
    }
    return result;
  }

  /**
   * Andra källor som rapporterat samma story, per kluster. Går genom samma omfång som övrig läsning,
   * så att man aldrig ser en källa från en artikel man inte får se. En fråga för alla kluster (inte en per artikel).
   */
  async sourcesByCluster(
    userId: string,
    clusterIds: string[],
  ): Promise<Map<string, { id: number; url: string; source_name: string }[]>> {
    const result = new Map<string, { id: number; url: string; source_name: string }[]>();
    if (!clusterIds.length) return result;
    const scope = await this.scopes.get(userId);
    const rows: { id: number; cluster_id: string; url: string; source_name: string }[] = await this.scoped(scope)
      .whereIn('cluster_id', clusterIds)
      .select('id', 'cluster_id', 'url', 'source_name')
      .orderBy('id');
    for (const r of rows) {
      const list = result.get(r.cluster_id) ?? [];
      list.push({ id: r.id, url: r.url, source_name: r.source_name });
      result.set(r.cluster_id, list);
    }
    return result;
  }
}
