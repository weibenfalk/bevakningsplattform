const TRACKING_PARAM = /^(utm_|fbclid|gclid)/;

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  url.searchParams.forEach((_value, key) => {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  });

  return url.toString().replace(/\/$/, '');
}
