/** Parametrar som bara spårar var en länk kom ifrån och aldrig ändrar innehållet. */
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|yclid$|igshid$|mc_cid$|mc_eid$|_hsenc$|_hsmi$)/i;

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  // Samla nycklarna först. Att ta bort parametrar medan man itererar över dem gör att varannan hoppas över.
  const tracking = [...new Set([...url.searchParams.keys()].filter((key) => TRACKING_PARAM.test(key)))];
  for (const key of tracking) url.searchParams.delete(key);

  return url.toString().replace(/\/$/, '');
}
