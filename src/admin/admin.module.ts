import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AdminController } from './admin.controller';
import { QueryTestService } from './query-test.service';

@Module({
  imports: [AccessModule, ProfilesModule],
  controllers: [AdminController],
  providers: [QueryTestService],
})
export class AdminModule {}
