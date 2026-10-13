import { Module } from '@nestjs/common';
import { RunLogService } from './run-log.service';

@Module({ providers: [RunLogService], exports: [RunLogService] })
export class RunsModule {}
