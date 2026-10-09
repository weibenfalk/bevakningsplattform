import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { ContentScopeService } from './content-scope.service';

export interface ArticleQuery {
  q?: string;
  sort?: string;
  limit?: number;
}

/** Den enda vägen in till artiklar. All läsning ska gå härigenom. */
@Injectable()
export class ArticleAccessService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly scopes: ContentScopeService,
  ) {}

  async forUser(userId: string, opts: ArticleQuery = {}) {
    const scope = await this.scopes.get(userId);

    const query = this.knex('articles')
      .where('spaces', '&&', scope.spaces)
      // akuta händelser ska alltid nå ut
      .orWhere('urgency', 'akut');

    if (scope.denyEntities.length) {
      query.whereNot('entity_ids', '&&', scope.denyEntities);
    }
    if (opts.q) {
      query.andWhereRaw(`search_vector @@ websearch_to_tsquery('swedish', ?)`, [opts.q]);
    }

    return query
      .orderByRaw(opts.sort ?? 'relevance desc')
      .limit(opts.limit ?? 100)
      .select('*');
  }
}
