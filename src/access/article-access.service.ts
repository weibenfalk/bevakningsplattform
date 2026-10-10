import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { ContentScope, ContentScopeService } from './content-scope.service';

export interface ArticleQuery {
  q?: string;
  sort?: string;
  limit?: number;
}

/** Det dubblettkontrollen behöver veta om en sparad artikel. Ingen text. */
export interface StoredIdentity {
  raw_id: string;
  url: string;
  content_hash: string | null;
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
  cluster_id: string | null;
  entity_ids: string[];
  categories: string[];
  published_at: Date | null;
}

/**
 * Kolumner som får lämna åtkomstmodulen. Lista uttryckligen, aldrig `select('*')`:
 * en ny kolumn (t.ex. `full_text`) ska inte läcka förrän någon valt det.
 */
const PUBLIC_COLUMNS = [
  'id', 'raw_id', 'url', 'source_name', 'title', 'summary', 'spaces', 'urgency',
  'impact', 'confidence', 'relevance', 'cluster_id', 'entity_ids', 'categories', 'published_at',
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

/** Den enda vägen in till artiklar. All läsning ska gå härigenom. */
@Injectable()
export class ArticleAccessService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly scopes: ContentScopeService,
  ) {}

  /** Villkoren som alltid gäller: omfånget, nekade entiteter och kategorier, och inga flaggade artiklar. */
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
    return query;
  }

  async forUser(userId: string, opts: ArticleQuery = {}): Promise<ArticleRow[]> {
    const { column, order } = parseSort(opts.sort);
    const scope = await this.scopes.get(userId);

    const query = this.scoped(scope);
    if (opts.q) {
      query.andWhereRaw(`search_vector @@ websearch_to_tsquery('swedish', ?)`, [opts.q]);
    }

    return query
      .select(PUBLIC_COLUMNS as unknown as string[])
      .orderBy([{ column, order }, { column: 'id', order: 'asc' }])
      .limit(opts.limit ?? 100) as unknown as Promise<ArticleRow[]>;
  }

  /**
   * Identiteten (id, URL och innehållshash) hos redan sparade artiklar, för dubblettkontrollen i pipelinen (krav 7).
   * Medvetet utan användaromfång: dubbletter måste upptäckas oavsett vem som får se artikeln. Därför lämnar den bara
   * dessa tre kolumner, och den används aldrig för att visa något för en användare.
   */
  async storedIdentities(urls: string[], rawIds: string[]): Promise<StoredIdentity[]> {
    return this.knex('articles')
      .whereIn('url', urls)
      .orWhereIn('raw_id', rawIds)
      .select('raw_id', 'url', 'content_hash');
  }

  /**
   * Antal träffar för en entitet sedan en viss tid, för trendberäkningen. Medvetet utan användaromfång: det är en
   * siffra över hela systemet och ingen artikel lämnar modulen.
   */
  async countEntityMatches(entityId: string, since: Date): Promise<number> {
    const row = await this.knex('entity_matches')
      .where('entity_id', entityId)
      .andWhere('created_at', '>=', since)
      .count<{ count: string }>('* as count')
      .first();
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
