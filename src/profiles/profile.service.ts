import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Knex } from 'knex';
import { existsSync, readFileSync } from 'node:fs';
import { ArticleAccessService } from '../access/article-access.service';
import { ContentScopeService } from '../access/content-scope.service';
import { KNEX } from '../db/knex.provider';
import { matches, nodeText, notNodes, relaxNot } from '../query/evaluator';
import { Field, parse } from '../query/parser';
import { loadEntityNames, toQueryArticle } from './query-article';
import { QuerySyntaxError } from '../query/tokenizer';
import { RunLogService } from '../runs/run-log.service';

/** Filen profilerna läses in från, om inget annat anges. */
export const DEFAULT_PROFILES_FILE = 'data/profiles.json';

export interface ProfileProblem {
  message: string;
  position?: number;
}

/** Är posten en giltig profil (form och fråga)? Samma kontroll vid inläsning och i adminvyn. `null` = giltig. */
export function checkProfile(entry: unknown): ProfileProblem | null {
  const e = entry as Record<string, unknown> | null;
  if (typeof e?.id !== 'string' || typeof e.user !== 'string' || typeof e.query !== 'string') {
    return { message: 'Profilen måste ha id, user och query som text' };
  }
  return checkQuery(e.query);
}

/** Går frågan att tolka med de fält artiklarna har data för? `null` = ja. */
export function checkQuery(query: string): ProfileProblem | null {
  try {
    parse(query, { fields: PROFILE_FIELDS });
    return null;
  } catch (e) {
    if (!(e instanceof QuerySyntaxError)) throw e;
    return { message: e.message, position: e.position };
  }
}

/**
 * Fält som artiklarna har data för. `author`, `region` och `lang` sparas inte på artiklarna än. En profil som
 * använder dem hoppas över med ett tydligt fel, eftersom den annars tyst skulle matcha ingenting
 * (och `NOT lang:en` allt).
 */
export const PROFILE_FIELDS: readonly Field[] = ['title', 'body', 'source', 'domain', 'entity', 'category', 'area'];

export interface ProfileLoadReport {
  /** Profiler som är sparade (och oförändrade eller nya versioner). */
  loaded: string[];
  /** Profiler som hoppades över, med orsaken. Körningen fortsätter. */
  skipped: { id: string; reason: string; position?: number }[];
}

export interface ProfileStatus {
  id: string;
  query: string;
  status: 'valid' | 'broken';
  error: ProfileProblem | null;
  /** Senaste sparade version. `null` om profilen aldrig sparats (trasig från början). */
  version: number | null;
  /** Frågan som pipelinen faktiskt kör, om den skiljer sig från frågan i filen. */
  runningQuery: string | null;
  /** Artiklarna (raw_id) profilen träffade i senaste körningen, och totalt. */
  lastRunMatches: string[];
  totalMatches: string[];
  /** Artiklar i senaste körningen som en NOT i frågan uteslöt (de hade träffat utan just det villkoret). */
  excluded: { rawId: string; by: string }[];
}

export interface LastRun {
  startedAt: string;
  /** Pipelinens klocka för körningen (dag 1, dag 2 ...). `null` för körningar som saknar den. */
  pipelineNow: string | null;
}

export interface ActiveProfile {
  id: string;
  ownerId: string;
  version: number;
  query: string;
}

/** Läser in profiler ur en fil och sparar dem versionerade (specens avsnitt 6: "Profiler versioneras"). */
@Injectable()
export class ProfileService {
  private readonly log = new Logger(ProfileService.name);

  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly scopes: ContentScopeService,
    private readonly access: ArticleAccessService,
    private readonly runs: RunLogService,
  ) {}

  /**
   * Varje profil prövas för sig. En profil som inte går att tolka, har okänd ägare eller saknar fält loggas och
   * hoppas över, men stoppar aldrig de andra. En omkörning ändrar inget: en ny version skapas bara när frågan ändrats.
   */
  async loadFromFile(file: string): Promise<ProfileLoadReport> {
    const entries: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const report: ProfileLoadReport = { loaded: [], skipped: [] };
    if (!Array.isArray(entries)) throw new Error(`${file} ska innehålla en lista med profiler`);

    for (const entry of entries as Record<string, unknown>[]) {
      const id = String(entry?.id ?? '(utan id)');
      const skip = (reason: string, position?: number) => {
        this.log.warn(`Profilen ${id} hoppas över: ${reason}`);
        report.skipped.push({ id, reason, ...(position !== undefined ? { position } : {}) });
      };

      const problem = checkProfile(entry);
      if (problem) {
        skip(problem.message, problem.position);
        continue;
      }
      const valid = entry as { id: string; user: string; query: string }; // kontrollerat av checkProfile
      let spaces: string[];
      try {
        spaces = (await this.scopes.get(valid.user)).spaces;
      } catch (e) {
        // Bara "användaren finns inte" hoppar profilen över. Ett databasfel ska stoppa körningen, inte se ut som en okänd ägare.
        if (!(e instanceof NotFoundException)) throw e;
        skip(`Okänd användare ${valid.user} (inget innehållsomfång)`);
        continue;
      }
      await this.save(valid.id, valid.user, valid.query, spaces);
      report.loaded.push(valid.id);
    }
    return report;
  }

  private async save(id: string, owner: string, query: string, spaces: string[]): Promise<void> {
    await this.knex.transaction(async (trx) => {
      // Användartabellen fylls inte av något annat än så här än (autentisering saknas). Lägsta rollen räcker,
      // eftersom koden inte läser rollen härifrån. Platshållare tills användare läses in på riktigt.
      await trx('users').insert({ id: owner, name: owner, role: 'reader' }).onConflict('id').ignore();
      await trx('profiles').insert({ id, owner_id: owner, spaces }).onConflict('id').merge(['owner_id', 'spaces']);

      const latest = await trx('profile_versions').where({ profile_id: id }).orderBy('version', 'desc').first();
      if (!latest || latest.query !== query) {
        await trx('profile_versions').insert({ profile_id: id, version: (latest?.version ?? 0) + 1, query });
      }
    });
  }

  /** Varje profils senaste version. */
  async activeProfiles(): Promise<ActiveProfile[]> {
    const rows: { id: string; owner_id: string; version: number; query: string }[] = await this.knex('profiles as p')
      .join('profile_versions as v', 'v.profile_id', 'p.id')
      .whereRaw('v.version = (select max(version) from profile_versions where profile_id = p.id)')
      .select('p.id', 'p.owner_id', 'v.version', 'v.query')
      .orderBy('p.id');
    return rows.map((r) => ({ id: r.id, ownerId: r.owner_id, version: r.version, query: r.query }));
  }

  /**
   * Adminvyn: användarens profiler med status, version och vilka artiklar (raw_id) de träffade. Läs-bart.
   *
   * Trasiga profiler sparas inte (de hoppas över vid inläsning), så de finns bara i profilfilen. Därför läses filen här
   * med samma kontroll som vid inläsning. Statusen gäller frågan i filen. Har profilen en äldre, giltig version sparad
   * körs den fortfarande i pipelinen, och då anges den som `runningQuery`.
   *
   * `excluded`: artiklar i den senaste körningen som profilen inte träffade, men skulle ha träffat utan ett visst
   * NOT-villkor. Bara artiklar som ägaren får se.
   */
  async statusFor(userId: string, file = DEFAULT_PROFILES_FILE): Promise<{ lastRun: LastRun | null; profiles: ProfileStatus[] }> {
    await this.scopes.get(userId); // 404 för en okänd användare

    const entries: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    const fromFile = (Array.isArray(entries) ? entries : []).filter((e): e is Record<string, unknown> => (e as { user?: unknown } | null)?.user === userId);
    const stored = new Map((await this.activeProfiles()).filter((p) => p.ownerId === userId).map((p) => [p.id, p]));

    const run = (await this.runs.list()).filter((r) => r.step === 'profile_match' && r.status === 'ok').pop();
    const articleIds = Array.isArray(run?.details.articleIds) ? (run!.details.articleIds as number[]) : [];
    const matched = await this.access.profileMatchedArticlesForUser(userId, run?.startedAt ?? null);
    const entityNames = await loadEntityNames(this.knex);

    const rows = [
      ...fromFile.map((e) => ({ id: String(e.id ?? '(utan id)'), query: String(e.query ?? ''), problem: checkProfile(e) })),
      ...[...stored.values()]
        .filter((p) => !fromFile.some((e) => e.id === p.id))
        .map((p) => ({ id: p.id, query: p.query, problem: checkQuery(p.query) })),
    ];
    const profiles: ProfileStatus[] = [];
    for (const { id, query, problem } of rows) {
      const saved = stored.get(id);
      const found = matched.get(id);
      profiles.push({
        id,
        query,
        status: problem ? 'broken' : 'valid',
        error: problem,
        version: saved?.version ?? null,
        runningQuery: saved && saved.query !== query ? saved.query : null,
        lastRunMatches: found?.sinceRun ?? [],
        totalMatches: found?.total ?? [],
        // Det som körs i pipelinen är den sparade versionen (annars frågan i filen)
        excluded: await this.excludedByNot(userId, saved?.query ?? query, articleIds, entityNames),
      });
    }
    return {
      lastRun: run ? { startedAt: run.startedAt.toISOString(), pipelineNow: typeof run.details.pipelineNow === 'string' ? run.details.pipelineNow : null } : null,
      profiles,
    };
  }

  private async excludedByNot(userId: string, query: string, articleIds: number[], entityNames: Map<string, string>): Promise<{ rawId: string; by: string }[]> {
    if (!articleIds.length || checkQuery(query)) return [];
    const tree = parse(query, { fields: PROFILE_FIELDS });
    const nots = notNodes(tree);
    if (!nots.length) return [];
    const { hits } = await this.access.matchWholeArchive(userId, ({ title, body }, row) => {
      const article = toQueryArticle({ title, body }, row, entityNames);
      if (matches(tree, article)) return null;
      const culprit = nots.find((n) => matches(relaxNot(tree, n), article));
      return culprit ? [nodeText(culprit)] : null;
    }, 5000, articleIds);
    return hits.filter((h) => h.visible).map((h) => ({ rawId: h.row.raw_id, by: h.terms[0] }));
  }
}
