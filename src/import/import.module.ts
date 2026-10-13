import { Module } from '@nestjs/common';
import { EntityImportService } from './entity-import.service';

@Module({ providers: [EntityImportService], exports: [EntityImportService] })
export class ImportModule {}
