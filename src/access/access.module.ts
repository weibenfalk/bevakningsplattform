import { Module } from '@nestjs/common';
import { ArticleAccessService } from './article-access.service';
import { ContentScopeService } from './content-scope.service';

/** Enda vägen till innehållstabellerna (krav 1). Se test/architecture.spec.ts. */
@Module({ providers: [ContentScopeService, ArticleAccessService], exports: [ContentScopeService, ArticleAccessService] })
export class AccessModule {}
