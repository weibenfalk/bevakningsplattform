import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ArticleAccessService, HiddenReason } from '../access/article-access.service';
import { SOURCE_NAMES, sourceLabel } from '../config/sources';
import { KNEX } from '../db/knex.provider';
import { PROFILE_FIELDS } from '../profiles/profile.service';
import { explain, matches } from '../query/evaluator';
import { parse } from '../query/parser';
import { QuerySyntaxError } from '../query/tokenizer';
import { loadEntityNames, toQueryArticle } from '../profiles/query-article';

export type QueryTestResult =
  | { syntaxError: { message: string; position: number } }
  | {
      matches: {
        id: number;
        title: string;
        url: string;
        source: string | null;
        relevance: number | null;
        spaces: string[];
        terms: string[];
        textSource: 'fulltext' | 'summary';
        /** Skulle den valda användaren få se artikeln? */
        visibleToUser: boolean;
        /** Varför inte, på svenska. Tom när artikeln syns. */
        hiddenReasons: string[];
      }[];
      /** Hur många av träffarna den valda användaren får se. */
      visibleCount: number;
      /** Antal artiklar i arkivet som provades (alla som inte är flaggade), och hur många av dem som saknar originaltext (rensad) och därför bara matchades på rubrik och sammanfattning. */
      searched: number;
      withoutFullText: number;
    };

/** Så många artiklar i arkivet provas (högst poäng först). */
const ARCHIVE_LIMIT = 5000;

/**
 * Frågetestaren (specens avsnitt 6): provar en profilfråga mot hela arkivet ("vad hade profilen fångat") och anger för
 * varje träff om den valda användaren skulle få se artikeln, och annars varför inte. Bara admin (`AdminGuard`).
 * Samma regler som profilmatchningen i pipelinen (samma fält, samma utvärdering, samma text). Matchningen sker inne i
 * åtkomstmodulen (`matchWholeArchive`), så originaltexten lämnar aldrig den: härifrån syns bara rubrik, poäng och
 * termerna som träffade. Är originaltexten rensad matchas rubrik och sammanfattning, och svaret säger det.
 */
@Injectable()
export class QueryTestService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly access: ArticleAccessService,
    @Inject(SOURCE_NAMES) private readonly sourceNames: Map<string, string>,
  ) {}

  async test(userId: string, query: string): Promise<QueryTestResult> {
    let tree;
    try {
      tree = parse(query, { fields: PROFILE_FIELDS });
    } catch (e) {
      if (!(e instanceof QuerySyntaxError)) throw e;
      return { syntaxError: { message: e.message, position: e.position } };
    }

    const entityNames = await loadEntityNames(this.knex);
    const { hits, searched, withoutFullText } = await this.access.matchWholeArchive(userId, ({ title, body }, a) => {
      const article = toQueryArticle({ title, body }, a, entityNames);
      if (!matches(tree, article)) return null;
      // En fråga som bara har NOT-villkor har ingen träffande term. Då är frågan själv termen (som i pipelinen).
      const terms = [...new Set(explain(tree, article))];
      return terms.length ? terms : [query];
    }, ARCHIVE_LIMIT);

    return {
      matches: hits.map(({ row, terms, textSource, visible, hiddenReasons }) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        source: sourceLabel(this.sourceNames, row.source_name),
        relevance: row.relevance,
        spaces: row.spaces,
        terms,
        textSource,
        visibleToUser: visible,
        hiddenReasons: hiddenReasons.map((r) => this.reasonText(r, entityNames)),
      })),
      visibleCount: hits.filter((h) => h.visible).length,
      searched,
      withoutFullText,
    };
  }

  /** Orsaken i klartext. Källor och entiteter visas med namn när de går att slå upp, annars med id. */
  private reasonText(r: HiddenReason, entityNames: Map<string, string>): string {
    const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'inga');
    const entities = (xs: string[]) => list(xs.map((id) => entityNames.get(id) ?? id));
    const sources = (xs: string[]) => list(xs.map((id) => sourceLabel(this.sourceNames, id) ?? id));
    switch (r.code) {
      case 'space': return `Fel arbetsyta: artikeln är i ${list(r.article)}, användaren har ${list(r.user)}`;
      case 'deny_category': return `Nekad kategori: ${list(r.article)}`;
      case 'deny_entity': return `Nekad entitet: ${entities(r.article)}`;
      case 'deny_source': return `Nekad källa: ${sources(r.article)}`;
      case 'allow_category': return `Ingen av artikelns kategorier (${list(r.article)}) är tillåten (tillåtna: ${list(r.user)})`;
      case 'allow_entity': return `Ingen av artikelns entiteter (${entities(r.article)}) är tillåten (tillåtna: ${entities(r.user)})`;
      case 'allow_source': return `Ingen tillåten källa: artikeln är från ${sources(r.article)} (tillåtna: ${list(r.user)})`;
      case 'urgency': return `Brådskan ${list(r.article)} syns inte för användaren (syns: ${list(r.user)})`;
      case 'unknown': return 'Syns inte, men orsaken gick inte att avgöra';
    }
  }
}
