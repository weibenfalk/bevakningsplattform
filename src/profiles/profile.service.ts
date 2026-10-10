import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { readFileSync } from 'node:fs';
import { ContentScopeService } from '../access/content-scope.service';
import { KNEX } from '../db/knex.provider';
import { Field, parse } from '../query/parser';
import { QuerySyntaxError } from '../query/tokenizer';

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

      if (typeof entry?.id !== 'string' || typeof entry.user !== 'string' || typeof entry.query !== 'string') {
        skip('Profilen måste ha id, user och query som text');
        continue;
      }
      try {
        parse(entry.query, { fields: PROFILE_FIELDS });
      } catch (e) {
        if (!(e instanceof QuerySyntaxError)) throw e;
        skip(e.message, e.position);
        continue;
      }
      let spaces: string[];
      try {
        spaces = (await this.scopes.get(entry.user)).spaces;
      } catch {
        skip(`Okänd användare ${entry.user} (inget innehållsomfång)`);
        continue;
      }
      await this.save(entry.id, entry.user, entry.query, spaces);
      report.loaded.push(entry.id);
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
}
