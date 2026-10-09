import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { Space } from '../types';

export interface ContentScope {
  userId: string;
  spaces: Space[];
  denyCategories: string[];
  denyEntities: string[];
}

@Injectable()
export class ContentScopeService {
  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  async get(userId: string): Promise<ContentScope> {
    const row = await this.knex('content_scopes').where({ user_id: userId }).first();
    if (!row) throw new NotFoundException(`Inget innehållsomfång för ${userId}`);
    return {
      userId,
      spaces: row.spaces,
      denyCategories: row.deny_categories ?? [],
      denyEntities: row.deny_entities ?? [],
    };
  }
}
