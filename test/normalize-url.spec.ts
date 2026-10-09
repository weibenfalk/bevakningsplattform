import { normalizeUrl } from '../src/pipeline/normalize-url';

describe('normalizeUrl', () => {
  const base = 'https://poit.example.se/kungorelse/2026-123456';

  it('tar bort alla spårningsparametrar (r01 och r03 är samma kungörelse)', () => {
    expect(normalizeUrl(`${base}?utm_source=rss&utm_medium=feed`)).toBe(base);
    expect(normalizeUrl(`${base}?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d`)).toBe(base);
  });

  it('tar bort kända klick-id:n, även i följd och med andra versaler', () => {
    expect(normalizeUrl(`${base}?fbclid=1&gclid=2&msclkid=3&mc_cid=4&mc_eid=5`)).toBe(base);
    expect(normalizeUrl(`${base}?UTM_Source=x&FBCLID=y`)).toBe(base);
  });

  it('behåller parametrar som inte är spårning, i sin ordning', () => {
    expect(normalizeUrl(`${base}?id=5&utm_source=x&page=2&utm_medium=y`)).toBe(`${base}?id=5&page=2`);
  });

  it('lämnar ingen tom frågesträng efter sig', () => {
    expect(normalizeUrl(`${base}?utm_source=x`)).not.toContain('?');
  });

  it('tar bort fragment och normaliserar värdnamnet och avslutande snedstreck', () => {
    expect(normalizeUrl('https://POIT.Example.se/kungorelse/2026-123456/#avsnitt')).toBe(base);
  });

  it('en url utan parametrar är oförändrad', () => {
    expect(normalizeUrl(base)).toBe(base);
  });
});
