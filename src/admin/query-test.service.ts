import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ArticleAccessService } from '../access/article-access.service';
import { KNEX } from '../db/knex.provider';
import { PROFILE_FIELDS } from '../profiles/profile.service';
import { Article, explain, matches } from '../query/evaluator';
import { parse } from '../query/parser';
import { QuerySyntaxError } from '../query/tokenizer';

export type QueryTestResult =
  | { syntaxError: { message: string; position: number } }
  | {
      matches: { id: number; title: string; url: string; relevance: number | null; terms: string[]; textSource: 'fulltext' | 'summary' }[];
      /** Antal artiklar som provades, och hur många av dem som saknar originaltext (rensad) och därför bara matchades på rubrik och sammanfattning. */
      searched: number;
      withoutFullText: number;
    };

/** Så många artiklar i användarens omfång provas (högst poäng först). */
const ARCHIVE_LIMIT = 5000;

/**
 * Frågetestaren (specens avsnitt 6): provar en profilfråga mot arkivet inom en användares omfång. Samma regler som
 * profilmatchningen i pipelinen (samma fält, samma utvärdering). Texten är rubrik och sammanfattning: artiklarna
 * läses via åtkomstmodulen, som aldrig lämnar ut originaltexten, så fulltexten kan inte matchas eller läcka.
 */
@Injectable()
export class QueryTestService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly access: ArticleAccessService,
  ) {}

  async test(userId: string, query: string): Promise<QueryTestResult> {
    let tree;
    try {
      tree = parse(query, { fields: PROFILE_FIELDS });
    } catch (e) {
      if (!(e instanceof QuerySyntaxError)) throw e;
      return { syntaxError: { message: e.message, position: e.position } };
    }

    const entityNames = new Map<string, string>(
      (await this.knex('entities').select('id', 'name')).map((e: { id: number; name: string }) => [String(e.id), e.name]),
    );
    const { hits, searched, withoutFullText } = await this.access.matchArchive(userId, ({ title, body }, a) => {
      const article: Article = {
        title,
        body,
        source: a.source_name ?? undefined,
        domain: hostOf(a.url),
        entity: a.entity_ids.map((id) => entityNames.get(id)).filter((n): n is string => n !== undefined),
        category: a.categories,
        area: a.spaces,
      };
      if (!matches(tree, article)) return null;
      // En fråga som bara har NOT-villkor har ingen träffande term. Då är frågan själv termen (som i pipelinen).
      const terms = [...new Set(explain(tree, article))];
      return terms.length ? terms : [query];
    }, ARCHIVE_LIMIT);

    return {
      matches: hits.map(({ row, terms, textSource }) => ({ id: row.id, title: row.title, url: row.url, relevance: row.relevance, terms, textSource })),
      searched,
      withoutFullText,
    };
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
