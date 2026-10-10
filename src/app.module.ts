import { Module } from '@nestjs/common';
import { ArticleAccessService } from './access/article-access.service';
import { ContentScopeService } from './access/content-scope.service';
import { AdminController } from './admin/admin.controller';
import { QueryTestService } from './admin/query-test.service';
import { ExportController } from './admin/export.controller';
import { CLOCK, fixedClock } from './config/clock';
import { SOURCE_WEIGHTS, loadSourceWeights } from './config/sources';
import { USER_DIRECTORY, loadUserDirectory } from './config/users';
import { knexProvider } from './db/knex.provider';
import { DigestService } from './digest/digest.service';
import { EntityImportService } from './import/entity-import.service';
import { LLM } from './llm/llm.provider';
import { StubProvider } from './llm/stub.provider';
import { EnrichService } from './pipeline/enrich.service';
import { PipelineService } from './pipeline/pipeline.service';
import { PurgeService } from './pipeline/purge.service';
import { ProfileMatchService } from './pipeline/profile-match.service';
import { ProfileService } from './profiles/profile.service';
import { RunLogService } from './pipeline/run-log.service';
import { TrendService } from './pipeline/trend.service';
import { TriageService } from './pipeline/triage.service';

/** Platshållare: moduluppsättningen saknades i startkoden. */
@Module({
  controllers: [ExportController, AdminController],
  providers: [
    knexProvider,
    { provide: CLOCK, useValue: fixedClock() },
    { provide: SOURCE_WEIGHTS, useValue: loadSourceWeights() },
    { provide: USER_DIRECTORY, useValue: loadUserDirectory() },
    { provide: LLM, useClass: StubProvider },
    ContentScopeService,
    ArticleAccessService,
    DigestService,
    QueryTestService,
    EnrichService,
    ProfileService,
    ProfileMatchService,
    PipelineService,
    RunLogService,
    PurgeService,
    TriageService,
    TrendService,
    EntityImportService,
  ],
})
export class AppModule {}
