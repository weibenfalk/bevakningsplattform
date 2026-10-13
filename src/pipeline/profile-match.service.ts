import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { ArticleAccessService } from '../access/article-access.service';
import { CLOCK, Clock } from '../config/clock';
import { KNEX } from '../db/knex.provider';
import { PROFILE_FIELDS, ProfileService } from '../profiles/profile.service';
import { loadEntityNames, toQueryArticle } from '../profiles/query-article';
import { explain, matches } from '../query/evaluator';
import { parse } from '../query/parser';
import { QuerySyntaxError } from '../query/tokenizer';
import { StoredArticle } from './enrich.service';
import { RunLogService } from '../runs/run-log.service';

export interface MatchReport {
  /** Profiler som kördes. */
  profilesRun: number;
  /** Profiler vars fråga inte gick att tolka (en äldre version kan använda ett fält som inte stöds, och då körs profilen inte). */
  invalid: string[];
  /** Antal sparade rader i `profile_matches` för den här körningen. */
  rows: number;
}

/**
 * Profilmatchning i batch, efter berikningen (krav 3). Varje profil körs mot de nya artiklarna, och träffarna
 * sparas med profil, version, term och poäng.
 *
 * Texten (rubrik och brödtext) kommer från berikningen, som redan har den. Åtkomstmodulen lämnar aldrig ut
 * fulltexten, så den läses inte om härifrån. Följden är att nya profiler inte kan köras mot arkivet förrän
 * någon bestämmer hur arkivtexten ska nås (frågetestaren, se beslutsloggen).
 */
@Injectable()
export class ProfileMatchService {
  private readonly log = new Logger(ProfileMatchService.name);

  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly profiles: ProfileService,
    private readonly access: ArticleAccessService,
    private readonly runs: RunLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Steget loggas i pipeline_runs: in är antal artiklar, ut är antal sparade träffar och överhoppade är profiler
   * som inte gick att tolka.
   */
  async run(stored: StoredArticle[], now: Date = this.clock.now()): Promise<MatchReport> {
    return this.runs.record('profile_match', async (run) => {
      // Körningens klocka och artiklarna den gällde sparas, så att adminvyn kan visa vilken dag och vilka artiklar profilerna provades mot.
      run.set({ itemsIn: stored.length, pipelineNow: now.toISOString(), articleIds: stored.map((s) => s.id) });
      const report = await this.match(stored);
      run.set({ itemsOut: report.rows, itemsSkipped: report.invalid.length, profilesRun: report.profilesRun });
      return report;
    });
  }

  private async match(stored: StoredArticle[]): Promise<MatchReport> {
    const report: MatchReport = { profilesRun: 0, invalid: [], rows: 0 };
    if (stored.length === 0) return report;

    const ids = stored.map((s) => s.id);
    const text = new Map(stored.map((s) => [s.id, s]));
    const entityNames = await loadEntityNames(this.knex);

    for (const profile of await this.profiles.activeProfiles()) {
      let tree;
      try {
        tree = parse(profile.query, { fields: PROFILE_FIELDS });
      } catch (e) {
        if (!(e instanceof QuerySyntaxError)) throw e;
        this.log.warn(`Profilen ${profile.id} (version ${profile.version}) går inte att tolka: ${e.message}`);
        report.invalid.push(profile.id);
        continue;
      }
      report.profilesRun++;

      // Bara artiklar som profilens ägare får se (arbetsytan är en hård gräns), via åtkomstmodulen.
      const rows: { profile_id: string; profile_version: number; article_id: number; term: string; score: number }[] = [];
      for (const visible of await this.access.visibleAmong(profile.ownerId, ids)) {
        const s = text.get(visible.id)!;
        const article = toQueryArticle({ title: s.title, body: s.body }, visible, entityNames);
        if (!matches(tree, article)) continue;
        // En fråga som bara har NOT-villkor har ingen träffande term. Då är frågan själv termen.
        const terms = [...new Set(explain(tree, article))];
        for (const term of terms.length ? terms : [profile.query]) {
          // Poängen är 1 för en boolesk träff. Den semantiska delen av matchningen finns inte än.
          rows.push({ profile_id: profile.id, profile_version: profile.version, article_id: visible.id, term, score: 1 });
        }
      }

      // Idempotent: tidigare träffar för de här artiklarna ersätts, så en omkörning eller en ny version
      // varken dubblerar eller lämnar kvar gamla rader.
      await this.knex.transaction(async (trx) => {
        await trx('profile_matches').where({ profile_id: profile.id }).whereIn('article_id', ids).delete();
        if (rows.length) await trx('profile_matches').insert(rows);
      });
      report.rows += rows.length;
    }
    this.log.log(`${report.profilesRun} profiler kördes mot ${stored.length} nya artiklar, ${report.rows} träffar sparade`);
    return report;
  }
}
