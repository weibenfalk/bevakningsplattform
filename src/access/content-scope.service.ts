import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { Space, Urgency } from '../types';

/** Från mest till minst brådskande. */
export const URGENCY_ORDER: readonly Urgency[] = ['akut', 'agera', 'bevaka', 'info'];

export interface ContentScope {
  userId: string;
  spaces: Space[];
  /** Tom lista = ingen begränsning. Nekat vinner alltid över tillåtet. */
  allowCategories: string[];
  allowSources: string[];
  allowEntities: string[];
  denyCategories: string[];
  denySources: string[];
  denyEntities: string[];
  /** Brådskor användaren får se, härledda ur högsta synliga brådska. `null` = alla. */
  visibleUrgencies: Urgency[] | null;
}

@Injectable()
export class ContentScopeService {
  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  /** Alla användare med omfång, för adminverktyget. */
  async list(): Promise<{ userId: string; spaces: Space[] }[]> {
    const rows: { user_id: string; spaces: Space[] }[] = await this.knex('content_scopes').select('user_id', 'spaces').orderBy('user_id');
    return rows.map((r) => ({ userId: r.user_id, spaces: r.spaces }));
  }

  async get(userId: string): Promise<ContentScope> {
    const row = await this.knex('content_scopes').where({ user_id: userId }).first();
    if (!row) throw new NotFoundException(`Inget innehållsomfång för ${userId}`);
    let visibleUrgencies: Urgency[] | null = null;
    if (row.max_urgency != null) {
      const index = URGENCY_ORDER.indexOf(row.max_urgency);
      // Ett okänt värde ska inte tolkas som "alla": hellre ett fel än en läcka.
      if (index < 0) throw new Error(`Ogiltig högsta brådska för ${userId}: ${row.max_urgency}`);
      visibleUrgencies = URGENCY_ORDER.slice(index) as Urgency[];
    }
    return {
      userId,
      spaces: row.spaces,
      allowCategories: row.allow_categories ?? [],
      allowSources: row.allow_sources ?? [],
      allowEntities: row.allow_entities ?? [],
      denyCategories: row.deny_categories ?? [],
      denySources: row.deny_sources ?? [],
      denyEntities: row.deny_entities ?? [],
      visibleUrgencies,
    };
  }
}
