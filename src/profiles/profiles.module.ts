import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { RunsModule } from '../runs/runs.module';
import { ProfileService } from './profile.service';

@Module({ imports: [AccessModule, RunsModule], providers: [ProfileService], exports: [ProfileService] })
export class ProfilesModule {}
