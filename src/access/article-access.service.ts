import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { ContentScopeService } from './content-scope.service';

export interface ArticleQuery {
  q?: string;
  sort?: string;
  limit?: number;
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

  async forUser(userId: string, opts: ArticleQuery = {}) {
    const { column, order } = parseSort(opts.sort);
    const scope = await this.scopes.get(userId);

    // Arbetsytan är en hård gräns, även för akuta händelser. Lägg aldrig till en
    // orWhere här: den skulle förbigå alla filter som läggs på nedan.
    const query = this.knex('articles').where('spaces', '&&', scope.spaces);

    if (scope.denyEntities.length) {
      query.whereNot('entity_ids', '&&', scope.denyEntities);
    }
    if (scope.denyCategories.length) {
      query.whereNot('categories', '&&', scope.denyCategories);
    }
    if (opts.q) {
      query.andWhereRaw(`search_vector @@ websearch_to_tsquery('swedish', ?)`, [opts.q]);
    }

    return query
      .select(PUBLIC_COLUMNS as unknown as string[])
      .orderBy([{ column, order }, { column: 'id', order: 'asc' }])
      .limit(opts.limit ?? 100);
  }
}
