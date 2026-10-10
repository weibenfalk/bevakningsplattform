import { Inject, Injectable } from '@nestjs/common';
import { ArticleAccessService } from '../access/article-access.service';
import { SOURCE_WEIGHTS } from '../config/sources';

const WINDOW_DAYS = 30;
const MIN_ARTICLES = 3;
/** Bara källor med minst denna vikt räknas in i en trend, så att forum, Facebook och bloggar inte kan skapa en. */
const MIN_TREND_SOURCE_WEIGHT = 1.0;

@Injectable()
export class TrendService {
  constructor(
    private readonly access: ArticleAccessService,
    @Inject(SOURCE_WEIGHTS) private readonly sourceWeights: Map<string, number>,
  ) {}

  /**
   * Är artikeln en trend? Ja om någon av dess entiteter har minst 3 unika artiklar de senaste 30 dygnen
   * (på `published_at`), artikeln själv inräknad. Artikeln räknas alltid som en, vare sig den redan är sparad
   * (`articleId`, en uppdatering) eller ännu inte är det, så att den inte räknas två gånger.
   * Bara artiklar från källor med vikt minst 1,0 räknas, även artikeln själv. En okänd källa räknas inte.
   */
  async isTrending(entityIds: string[], publishedAt: string | null, now: Date, source: string, articleId?: number): Promise<boolean> {
    const published = publishedAt ? Date.parse(publishedAt) : NaN;
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);
    // En artikel utan giltig publiceringstid, eller utanför fönstret, räknas inte själv.
    const countedSources = [...this.sourceWeights].filter(([, w]) => w >= MIN_TREND_SOURCE_WEIGHT).map(([id]) => id);
    const strong = countedSources.includes(source);
    const self = strong && published >= since.getTime() && published <= now.getTime() ? 1 : 0;
    for (const entityId of entityIds) {
      const others = await this.access.countArticlesAboutEntity(entityId, since, now, countedSources, articleId);
      if (others + self >= MIN_ARTICLES) return true;
    }
    return false;
  }
}
