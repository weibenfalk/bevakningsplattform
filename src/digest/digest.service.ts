import { Injectable } from '@nestjs/common';
import { ArticleAccessService, ArticleRow } from '../access/article-access.service';
import { pipelineConfig } from '../config/pipeline.config';
import { renderDigest, DigestArticle } from './render';

const URGENCY_ORDER = { akut: 0, agera: 1, bevaka: 2, info: 3 } as const;

/** Brådska först, därefter relevans. */
const byUrgencyThenRelevance = (a: ArticleRow, b: ArticleRow) =>
  URGENCY_ORDER[a.urgency as keyof typeof URGENCY_ORDER] - URGENCY_ORDER[b.urgency as keyof typeof URGENCY_ORDER]
  || (b.relevance ?? 0) - (a.relevance ?? 0);

/** Så många kandidater hämtas högst. Sorteringen på brådska görs efteråt, så alla över tröskeln ska vara med. */
const CANDIDATE_LIMIT = 1000;

@Injectable()
export class DigestService {
  constructor(private readonly access: ArticleAccessService) {}

  /**
   * Nästa utskick till användaren, som HTML. Sparar ingenting, så det går att förhandsgranska hur många gånger
   * som helst. Det som redan skickats till användaren ingår inte (se `send`).
   */
  async compose(userId: string): Promise<string> {
    return (await this.build(userId)).html;
  }

  /**
   * Skickar utskicket: bygger det och sparar vilka artiklar som ingick, så att samma artikel aldrig skickas till
   * samma användare igen. En omkörning direkt efter ger ett tomt utskick.
   */
  async send(userId: string, sentAt: Date = new Date()): Promise<{ html: string; articleIds: number[] }> {
    const { html, articleIds } = await this.build(userId);
    await this.access.recordSent(userId, articleIds, sentAt);
    return { html, articleIds };
  }

  private async build(userId: string): Promise<{ html: string; articleIds: number[] }> {
    const { threshold, maxItems } = pipelineConfig.digest;

    // Rättelser ska alltid med: ingen tröskel och ingen gräns på antal. Omfånget (arbetsytan, nekade kategorier
    // och entiteter, flaggade artiklar) gäller ändå, liksom att redan skickat inte skickas igen.
    const corrections = await this.access.forUser(userId, { unsentOnly: true, onlyCorrections: true, limit: CANDIDATE_LIMIT });
    const correctionIds = new Set(corrections.map((a) => a.id));

    // Filtrera, sortera på brådska och därefter relevans, och begränsa sist. Annars tränger mer relevanta
    // artiklar ut en akut artikel med lägre poäng.
    const others = (await this.access.forUser(userId, { unsentOnly: true, minRelevance: threshold, limit: CANDIDATE_LIMIT }))
      .filter((a) => !correctionIds.has(a.id))
      .sort(byUrgencyThenRelevance)
      .slice(0, maxItems);

    const selected = [...corrections.sort(byUrgencyThenRelevance), ...others];

    const clusterIds = [...new Set(selected.flatMap((a) => (a.cluster_id ? [a.cluster_id] : [])))];
    const sources = await this.access.sourcesByCluster(userId, clusterIds);

    // Profilerna förklarar bara varför en artikel kom med. De styr inte urvalet (se beslutsloggen).
    const why = await this.access.profileMatchesForUser(userId, selected.map((a) => a.id));

    const items: DigestArticle[] = selected.map((a) => ({
      title: a.title,
      url: a.url,
      summary: a.summary,
      urgency: a.urgency,
      followUp: a.is_followup,
      why: (why.get(a.id) ?? []).map((w) => ({ profile: w.profileId, terms: w.terms })),
      otherSources: ((a.cluster_id ? sources.get(a.cluster_id) : undefined) ?? []).filter((s) => s.id !== a.id),
    }));
    return { html: renderDigest(items), articleIds: selected.map((a) => a.id) };
  }
}
