import { Injectable } from '@nestjs/common';
import { ArticleAccessService } from '../access/article-access.service';

const WINDOW_DAYS = 30;
const MIN_ARTICLES = 3;

@Injectable()
export class TrendService {
  constructor(private readonly access: ArticleAccessService) {}

  /**
   * Är artikeln en trend? Ja om någon av dess entiteter har minst 3 unika artiklar de senaste 30 dygnen
   * (på `published_at`), artikeln själv inräknad. Artikeln räknas alltid som en, vare sig den redan är sparad
   * (`articleId`, en uppdatering) eller ännu inte är det, så att den inte räknas två gånger.
   */
  async isTrending(entityIds: string[], publishedAt: string | null, now: Date, articleId?: number): Promise<boolean> {
    const published = publishedAt ? Date.parse(publishedAt) : NaN;
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);
    // En artikel utan giltig publiceringstid, eller utanför fönstret, räknas inte själv.
    const self = published >= since.getTime() && published <= now.getTime() ? 1 : 0;
    for (const entityId of entityIds) {
      const others = await this.access.countArticlesAboutEntity(entityId, since, now, articleId);
      if (others + self >= MIN_ARTICLES) return true;
    }
    return false;
  }
}
