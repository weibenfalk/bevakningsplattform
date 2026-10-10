import { Injectable } from '@nestjs/common';
import { ArticleAccessService } from '../access/article-access.service';

const WINDOW_DAYS = 30;
const MIN_HITS = 3;

@Injectable()
export class TrendService {
  constructor(private readonly access: ArticleAccessService) {}

  async isTrending(entityId: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);
    return (await this.access.countEntityMatches(entityId, since)) >= MIN_HITS;
  }
}
