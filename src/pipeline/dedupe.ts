import { createHash } from 'node:crypto';
import { StoredIdentity } from '../access/article-access.service';
import { RawItem } from '../types';
import { normalizeUrl } from './normalize-url';

export type SkipReason =
  /** Samma normaliserade URL och samma innehåll som en redan sparad (eller tidigare) post. */
  | 'duplicate'
  /** Samma normaliserade URL men nytt innehåll, och det går inte att avgöra vilken version som är nyast. Skrivs inte över. */
  | 'changed_content'
  /** Samma normaliserade URL men nytt innehåll, och den sparade versionen är nyare. Skrivs inte över. */
  | 'older_version'
  /** En nyare version, men den gick inte att ta emot (ogiltigt datum, eller ogiltigt AI-svar). Den gamla artikeln behålls. */
  | 'invalid_update'
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
  /** Problem som hittades när posten förbereddes (ogiltigt datum, misstänkt felkodad text). */
  problems?: string[];
}

/** En nyare version av en redan sparad artikel (samma URL, nytt innehåll). */
export interface Update {
  entry: Entry;
  existingRawId: string;
  /** Den sparade artikelns id. */
  articleId: number;
}

export interface DedupeResult {
  fresh: Entry[];
  /** Nyare versioner av sparade artiklar. Tillämpas av berikningen, som räknar om poängen. */
  updates: Update[];
  skipped: (SkippedItem & { raw: RawItem })[];
  /** Redan sparade poster som körs om (samma id, URL och innehåll). Ingen avvikelse, så de loggas inte. */
  alreadyStored: number;
}

interface Known {
  rawId: string;
  hash: string | null;
  /** Den sparade versionens tid i millisekunder, eller -Infinity om den saknas. */
  time: number;
  /** Artikelns id, om den redan är sparad. Poster som bara finns i den här körningen har inget. */
  articleId?: number;
}

/** Tid i millisekunder, och -Infinity om den saknas eller är ogiltig. Då är varje version med tid nyare. */
const timeOf = (iso: string | Date | null | undefined): number => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};

/** Hämtar identiteten hos sparade artiklar (via åtkomstmodulen, som är enda stället som läser `articles`). */
export type StoredLookup = (urls: string[], rawIds: string[]) => Promise<StoredIdentity[]>;

/**
 * Delar upp inkommande poster i nya, redan sparade och överhoppade. Identiteten är den normaliserade URL:en
 * (inte `raw_id`, som kommer från källan och inte är pålitligt). Den första posten vinner. Körs före triage och
 * berikning, så att en omkörning inte kostar några AI-anrop (krav 7: idempotens).
 */
export async function splitFresh(lookupStored: StoredLookup, entries: Entry[]): Promise<DedupeResult> {
  const urls = entries.map(({ prepared }) => {
    try { return normalizeUrl(prepared.url); } catch { return null; }
  });

  const stored = await lookupStored(
    urls.filter((u): u is string => u !== null),
    entries.map((e) => e.prepared.id),
  );
  const byUrl = new Map<string, Known>(
    stored.map((r) => [r.url, { rawId: r.raw_id, hash: r.content_hash, time: timeOf(r.updated_at ?? r.published_at), articleId: r.id }]),
  );
  const byId = new Set<string>(stored.map((r) => r.raw_id));

  const result: DedupeResult = { fresh: [], updates: [], skipped: [], alreadyStored: 0 };
  const seenId = new Set<string>();

  /**
   * Samma URL men annat innehåll. Det är en uppdatering bara om den nya versionen är *nyare* än den sparade.
   * En äldre version (till exempel dag 1 körd om efter dag 2) får aldrig skriva över en nyare, och när tiderna är
   * lika går det inte att avgöra vilken som gäller, så den sparade behålls. Att det aldrig går att byta fram och
   * tillbaka är det som gör en omkörning säker (krav 7).
   */
  const classifyChange = (entry: Entry, existing: Known, url: string) => {
    const { raw, prepared } = entry;
    const skip = (reason: SkipReason) => result.skipped.push({ raw, rawId: raw.id, url, reason, existingRawId: existing.rawId });

    if (entry.problems?.length) return skip('invalid_update');
    if (existing.articleId === undefined) return skip('changed_content'); // två olika versioner i samma körning

    const incoming = timeOf(prepared.updated_at || prepared.published_at);
    if (incoming > existing.time) {
      result.updates.push({ entry, existingRawId: existing.rawId, articleId: existing.articleId });
      // Nästa post med samma URL i den här körningen jämförs mot den här versionen.
      existing.hash = contentHash(prepared);
      existing.time = incoming;
    } else if (incoming < existing.time) {
      skip('older_version');
    } else {
      skip('changed_content');
    }
  };

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
      else if (sameContent) skip('duplicate', existing.rawId);
      else classifyChange(entry, existing, url);
      return;
    }
    if (byId.has(prepared.id) || seenId.has(prepared.id)) return skip('raw_id_collision', prepared.id);

    result.fresh.push(entry);
    byUrl.set(url, { rawId: prepared.id, hash: contentHash(prepared), time: timeOf(prepared.updated_at || prepared.published_at) });
    seenId.add(prepared.id);
  });

  return result;
}
