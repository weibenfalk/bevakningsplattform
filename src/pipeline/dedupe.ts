import { createHash } from 'node:crypto';
import { Knex } from 'knex';
import { RawItem } from '../types';
import { normalizeUrl } from './normalize-url';

export type SkipReason =
  /** Samma normaliserade URL och samma innehåll som en redan sparad (eller tidigare) post. */
  | 'duplicate'
  /** Samma normaliserade URL men nytt innehåll (till exempel en uppdatering). Skrivs inte över. */
  | 'changed_content'
  /** Samma id som en redan sparad post, men en annan URL: två olika dokument med samma id. */
  | 'raw_id_collision'
  /** URL:en går inte att tolka, så posten har ingen identitet. */
  | 'invalid_url';

export interface SkippedItem {
  rawId: string;
  url: string;
  reason: SkipReason;
  existingRawId?: string;
}

/** Hash av titel och text. Används för att se om innehållet ändrats, utan att läsa fulltexten. */
export const contentHash = (item: Pick<RawItem, 'title' | 'text'>): string =>
  createHash('sha256').update(`${item.title}\n${item.text}`).digest('hex');

export interface Entry {
  /** Posten som den kom in. Det är den som loggas, så att inget går förlorat. */
  raw: RawItem;
  /** Posten efter reparerad teckenkodning och tolkad tid. */
  prepared: RawItem;
}

export interface DedupeResult {
  fresh: Entry[];
  skipped: (SkippedItem & { raw: RawItem })[];
  /** Redan sparade poster som körs om (samma id, URL och innehåll). Ingen avvikelse, så de loggas inte. */
  alreadyStored: number;
}

interface Known {
  rawId: string;
  hash: string | null;
}

/**
 * Delar upp inkommande poster i nya, redan sparade och överhoppade. Identiteten är den normaliserade URL:en
 * (inte `raw_id`, som kommer från källan och inte är pålitligt). Den första posten vinner. Körs före triage och
 * berikning, så att en omkörning inte kostar några AI-anrop (krav 7: idempotens).
 */
export async function splitFresh(knex: Knex, entries: Entry[]): Promise<DedupeResult> {
  const urls = entries.map(({ prepared }) => {
    try { return normalizeUrl(prepared.url); } catch { return null; }
  });

  const stored = await knex('articles')
    .whereIn('url', urls.filter((u): u is string => u !== null))
    .orWhereIn('raw_id', entries.map((e) => e.prepared.id))
    .select('raw_id', 'url', 'content_hash');
  const byUrl = new Map<string, Known>(stored.map((r: any) => [r.url, { rawId: r.raw_id, hash: r.content_hash }]));
  const byId = new Set<string>(stored.map((r: any) => r.raw_id));

  const result: DedupeResult = { fresh: [], skipped: [], alreadyStored: 0 };
  const seenId = new Set<string>();

  entries.forEach((entry, index) => {
    const { raw, prepared } = entry;
    const url = urls[index];
    const skip = (reason: SkipReason, existingRawId?: string) =>
      result.skipped.push({ raw, rawId: raw.id, url: url ?? raw.url, reason, existingRawId });

    if (url === null) return skip('invalid_url');

    const existing = byUrl.get(url);
    if (existing) {
      const sameContent = existing.hash === contentHash(prepared);
      if (sameContent && existing.rawId === prepared.id) result.alreadyStored++;
      else skip(sameContent ? 'duplicate' : 'changed_content', existing.rawId);
      return;
    }
    if (byId.has(prepared.id) || seenId.has(prepared.id)) return skip('raw_id_collision', prepared.id);

    result.fresh.push(entry);
    byUrl.set(url, { rawId: prepared.id, hash: contentHash(prepared) });
    seenId.add(prepared.id);
  });

  return result;
}
