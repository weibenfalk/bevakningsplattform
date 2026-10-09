import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';

const WINDOW_DAYS = 30;
const MIN_HITS = 3;

@Injectable()
export class TrendService {
  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  async isTrending(entityId: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);
    const row = await this.knex('entity_matches')
      .where('entity_id', entityId)
      .andWhere('created_at', '>=', since)
      .count<{ count: string }>('* as count')
      .first();
    return Number(row?.count ?? 0) >= MIN_HITS;
  }
}
