import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { LlmModule } from '../llm/llm.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { RunsModule } from '../runs/runs.module';
import { EnrichService } from './enrich.service';
import { PipelineService } from './pipeline.service';
import { ProfileMatchService } from './profile-match.service';
import { PurgeService } from './purge.service';
import { TrendService } from './trend.service';
import { TriageService } from './triage.service';

@Module({
  imports: [AccessModule, LlmModule, ProfilesModule, RunsModule],
  providers: [PipelineService, EnrichService, ProfileMatchService, PurgeService, TriageService, TrendService],
  exports: [PipelineService, EnrichService, ProfileMatchService, PurgeService],
})
export class PipelineModule {}
