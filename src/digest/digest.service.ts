import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ArticleAccessService } from '../access/article-access.service';
import { pipelineConfig } from '../config/pipeline.config';
import { KNEX } from '../db/knex.provider';
import { renderDigest, DigestArticle } from './render';

const URGENCY_ORDER = { akut: 0, agera: 1, bevaka: 2, info: 3 } as const;

@Injectable()
export class DigestService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly access: ArticleAccessService,
  ) {}

  async compose(userId: string): Promise<string> {
    const { threshold, maxItems } = pipelineConfig.digest;
    const articles = await this.access.forUser(userId);

    const selected = articles
      .filter((a) => a.relevance > threshold)
      .slice(0, maxItems)
      .sort((a, b) => URGENCY_ORDER[a.urgency as keyof typeof URGENCY_ORDER]
        - URGENCY_ORDER[b.urgency as keyof typeof URGENCY_ORDER]
        || b.relevance - a.relevance);

    const items: DigestArticle[] = [];
    for (const a of selected) {
      items.push({ ...a, otherSources: await this.otherSources(a.cluster_id, a.id) });
    }
    return renderDigest(items);
  }

  /** Andra källor som rapporterat samma story, visas under artikeln. */
  private async otherSources(clusterId: string | null, excludeId: string) {
    if (!clusterId) return [];
    return this.knex('articles')
      .where('cluster_id', clusterId)
      .whereNot('id', excludeId)
      .select('url', 'source_name');
  }
}
