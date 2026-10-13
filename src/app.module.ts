import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AdminModule } from './admin/admin.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './db/database.module';
import { DigestModule } from './digest/digest.module';
import { ExportModule } from './export/export.module';
import { ImportModule } from './import/import.module';
import { LlmModule } from './llm/llm.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ProfilesModule } from './profiles/profiles.module';
import { RunsModule } from './runs/runs.module';

/** Roten: bara sammansättning. Varje område har sin egen modul. */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    LlmModule,
    AccessModule,
    RunsModule,
    ProfilesModule,
    PipelineModule,
    ImportModule,
    DigestModule,
    AdminModule,
    ExportModule,
  ],
})
export class AppModule {}
