/** Parametrar som bara spårar var en länk kom ifrån och aldrig ändrar innehållet. */
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|yclid$|igshid$|mc_cid$|mc_eid$|_hsenc$|_hsmi$)/i;

/** Parameterns namn så som det står i adressen, avkodat. Ett ogiltigt kodat namn används som det är. */
function keyOf(pair: string): string {
  const raw = pair.split('=')[0];
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * Adressen i sin normaliserade form: den är artikelns identitet. Bara http och https är artiklar, så
 * `javascript:`, `data:` och liknande avvisas här (kastar) och blir `invalid_url` i dubblettkontrollen.
 */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`Bara http och https kan vara en artikels adress: ${url.protocol}`);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  // Frågesträngen filtreras som text. `searchParams.delete` skulle skriva om alla parametrar (`%20` blir `+`),
  // och då får samma adress med och utan spårningsparameter olika identitet.
  url.search = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '' && !TRACKING_PARAM.test(keyOf(pair)))
    .join('&');

  return url.toString().replace(/\/$/, '');
}
