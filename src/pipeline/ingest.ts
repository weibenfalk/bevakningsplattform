import { RawItem } from '../types';

/** Tecken som en felaktig Latin-1/Windows-1252-avkodning ger för bytes 0x80–0x9F. */
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
/** UTF-8-bytes för å, ä, ö och liknande börjar på 0xC3 eller 0xC2, som visas som Ã eller Â när de läses som Latin-1. */
const MOJIBAKE_MARKER = /[ÃÂ]/;

export interface Repair {
  text: string;
  repaired: boolean;
  /** Ser felkodad ut men gick inte att reparera. */
  suspicious: boolean;
}

/** Reparerar UTF-8 som lästs som Latin-1/Windows-1252 ("FÃ¶nster" → "Fönster"). Korrekt text lämnas orörd. */
export function repairEncoding(text: string): Repair {
  if (!MOJIBAKE_MARKER.test(text)) return { text, repaired: false, suspicious: false };

  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const byte = code < 256 ? code : CP1252[char];
    if (byte === undefined) return { text, repaired: false, suspicious: true };
    bytes.push(byte);
  }
  try {
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    return { text: fixed, repaired: true, suspicious: false };
  } catch {
    return { text, repaired: false, suspicious: true };
  }
}

/** Förskjutningen mot UTC i minuter för en zon vid ett givet ögonblick, via Intl (inget beroende). */
function offsetMinutes(utcMs: number, zone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Tolkar en publiceringstid till ISO i UTC. Tid utan tidszon tolkas som Europe/Stockholm (antagande, se CLAUDE.md).
 * Tid med tidszon (Z eller ±hh:mm) behåller sin tidszon. Ogiltig tid ger null.
 * Begränsning: en lokal tid som inte finns (hoppet vid sommartidens start) eller som inträffar två gånger
 * (när sommartiden slutar) får en av de två möjliga tolkningarna.
 */
export function parsePublished(raw: string, zone = 'Europe/Stockholm'): string | null {
  const text = raw.trim();
  if (/:\d{2}(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(text) || /T\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0'].map(Number);
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid = naive.getUTCFullYear() === year && naive.getUTCMonth() === month - 1 && naive.getUTCDate() === day
    && hour < 24 && minute < 60 && second < 60;
  if (!valid) return null;

  const t = naive.getTime();
  const first = t - offsetMinutes(t, zone) * 60000;
  return new Date(t - offsetMinutes(first, zone) * 60000).toISOString();
}

export interface PreparedItem {
  item: RawItem;
  problems: string[];
}

/** Förbereder en råpost: reparerar teckenkodning och tolkar tiden. Problem rapporteras, de tigs aldrig ihjäl. */
export function prepareItem(item: RawItem): PreparedItem {
  const problems: string[] = [];
  const title = repairEncoding(item.title);
  const text = repairEncoding(item.text);
  if (title.suspicious || text.suspicious) problems.push('Misstänkt felkodad text');

  const published = parsePublished(item.published_at);
  if (published === null) problems.push(`Ogiltigt datum: "${item.published_at}"`);

  // updated_at finns bara på poster som källan har uppdaterat. Ett ogiltigt värde är ett problem, inte en gissad tid.
  let updated: string | undefined;
  if (item.updated_at !== undefined) {
    const parsed = parsePublished(item.updated_at);
    if (parsed === null) problems.push(`Ogiltigt datum i updated_at: "${item.updated_at}"`);
    else updated = parsed;
  }

  return { item: { ...item, title: title.text, text: text.text, published_at: published ?? '', updated_at: updated }, problems };
}
