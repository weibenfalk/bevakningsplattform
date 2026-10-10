import { Knex } from 'knex';
import { ArticleRow } from '../access/article-access.service';
import { Article } from '../query/evaluator';

/** Entitetsnamn per id, för fältet `entity:` i frågorna. */
export async function loadEntityNames(knex: Knex): Promise<Map<string, string>> {
  const rows: { id: number; name: string }[] = await knex('entities').select('id', 'name');
  return new Map(rows.map((e) => [String(e.id), e.name]));
}

/**
 * Det en fråga får titta på hos en artikel. Samma uppställning i profilmatchningen, frågetestaren och adminvyn,
 * så att en fråga aldrig ger olika svar på olika ställen.
 */
export function toQueryArticle(text: { title: string; body: string }, row: ArticleRow, entityNames: Map<string, string>): Article {
  return {
    title: text.title,
    body: text.body,
    source: row.source_name ?? undefined,
    domain: hostOf(row.url),
    entity: row.entity_ids.map((id) => entityNames.get(id)).filter((n): n is string => n !== undefined),
    category: row.categories,
    area: row.spaces,
  };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
