import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { DigestService } from './digest.service';

@Module({ imports: [AccessModule], providers: [DigestService], exports: [DigestService] })
export class DigestModule {}
