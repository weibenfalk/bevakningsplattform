/** Adressen om den är http eller https, annars `null`. Artiklarnas adresser kommer från externa källor (som `javascript:`). */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
