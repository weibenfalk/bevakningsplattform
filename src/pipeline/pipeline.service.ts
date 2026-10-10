import { Injectable } from '@nestjs/common';
import { DEFAULT_PROFILES_FILE, ProfileLoadReport, ProfileService } from '../profiles/profile.service';
import { EnrichReport, EnrichService } from './enrich.service';
import { MatchReport, ProfileMatchService } from './profile-match.service';

export interface PipelineOptions {
  /** Filen med profiler. */
  profilesFile?: string;
  /** Körningens klocka (dag 1 = 2026-10-01 07:00, dag 2 = 2026-10-03 07:00). Standard är pipelinens klocka. */
  now?: Date;
}

export interface PipelineReport {
  profiles: ProfileLoadReport;
  enrich: EnrichReport;
  matching: MatchReport;
}

/** Hela körningen i ordning: läs in profiler, berika, och matcha profilerna mot de nya artiklarna (krav 3). */
@Injectable()
export class PipelineService {
  constructor(
    private readonly profiles: ProfileService,
    private readonly enrich: EnrichService,
    private readonly matching: ProfileMatchService,
  ) {}

  async run(items: Parameters<EnrichService['run']>[0], options: PipelineOptions = {}): Promise<PipelineReport> {
    const profiles = await this.profiles.loadFromFile(options.profilesFile ?? DEFAULT_PROFILES_FILE);
    const enrich = await this.enrich.run(items, options.now);
    const matching = await this.matching.run(enrich.stored, options.now);
    return { profiles, enrich, matching };
  }
}
