import { Injectable } from '@nestjs/common';
import { ProfileLoadReport, ProfileService } from '../profiles/profile.service';
import { EnrichReport, EnrichService } from './enrich.service';
import { MatchReport, ProfileMatchService } from './profile-match.service';

export interface PipelineOptions {
  /** Filen med profiler. */
  profilesFile?: string;
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
    const profiles = await this.profiles.loadFromFile(options.profilesFile ?? 'data/profiles.json');
    const enrich = await this.enrich.run(items);
    const matching = await this.matching.run(enrich.stored);
    return { profiles, enrich, matching };
  }
}
