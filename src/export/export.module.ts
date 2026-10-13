import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ExportController } from './export.controller';

@Module({ imports: [AccessModule], controllers: [ExportController] })
export class ExportModule {}
