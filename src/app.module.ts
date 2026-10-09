import { Module } from '@nestjs/common';
import { ArticleAccessService } from './access/article-access.service';
import { ContentScopeService } from './access/content-scope.service';
import { ExportController } from './admin/export.controller';
import { knexProvider } from './db/knex.provider';
import { DigestService } from './digest/digest.service';
import { EntityImportService } from './import/entity-import.service';
import { LLM } from './llm/llm.provider';
import { StubProvider } from './llm/stub.provider';
import { EnrichService } from './pipeline/enrich.service';
import { TrendService } from './pipeline/trend.service';
import { TriageService } from './pipeline/triage.service';

/** Platshållare: moduluppsättningen saknades i startkoden. */
@Module({
  controllers: [ExportController],
  providers: [
    knexProvider,
    { provide: LLM, useClass: StubProvider },
    ContentScopeService,
    ArticleAccessService,
    DigestService,
    EnrichService,
    TriageService,
    TrendService,
    EntityImportService,
  ],
})
export class AppModule {}
