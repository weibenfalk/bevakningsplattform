import { Injectable } from '@nestjs/common';
import { ArticleAccessService } from '../access/article-access.service';
import { pipelineConfig } from '../config/pipeline.config';
import { renderDigest, DigestArticle } from './render';

const URGENCY_ORDER = { akut: 0, agera: 1, bevaka: 2, info: 3 } as const;

@Injectable()
export class DigestService {
  constructor(private readonly access: ArticleAccessService) {}

  async compose(userId: string): Promise<string> {
    const { threshold, maxItems } = pipelineConfig.digest;
    const articles = await this.access.forUser(userId);

    // Filtrera, sortera på brådska och därefter relevans, och begränsa sist. Annars tränger mer relevanta
    // artiklar ut en akut artikel med lägre poäng.
    const selected = articles
      .filter((a) => (a.relevance ?? 0) >= threshold)
      .sort((a, b) => URGENCY_ORDER[a.urgency as keyof typeof URGENCY_ORDER]
        - URGENCY_ORDER[b.urgency as keyof typeof URGENCY_ORDER]
        || (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, maxItems);

    const clusterIds = [...new Set(selected.flatMap((a) => (a.cluster_id ? [a.cluster_id] : [])))];
    const sources = await this.access.sourcesByCluster(userId, clusterIds);

    // Profilerna förklarar bara varför en artikel kom med. De styr inte urvalet (se beslutsloggen).
    const why = await this.access.profileMatchesForUser(userId, selected.map((a) => a.id));

    const items: DigestArticle[] = selected.map((a) => ({
      title: a.title,
      url: a.url,
      summary: a.summary,
      urgency: a.urgency,
      why: (why.get(a.id) ?? []).map((w) => ({ profile: w.profileId, terms: w.terms })),
      otherSources: ((a.cluster_id ? sources.get(a.cluster_id) : undefined) ?? []).filter((s) => s.id !== a.id),
    }));
    return renderDigest(items);
  }
}
