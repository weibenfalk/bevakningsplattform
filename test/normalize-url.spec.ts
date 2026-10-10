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

  it('tar bort fragment och normaliserar värdnamnet och avslutande snedstreck', () => {
    expect(normalizeUrl('https://POIT.Example.se/kungorelse/2026-123456/#avsnitt')).toBe(base);
  });

  it('en url utan parametrar är oförändrad', () => {
    expect(normalizeUrl(base)).toBe(base);
  });

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.se/fil', 'file:///etc/passwd'])(
    'avvisar %s: bara http och https kan vara en artikels adress',
    (url) => {
      expect(() => normalizeUrl(url)).toThrow(/http/i);
    },
  );

  it('samma adress med och utan spårningsparameter blir samma adress, även när övriga parametrar är kodade', () => {
    const plain = `${base}?q=a%20b&sida=2`;
    expect(normalizeUrl(`${plain}&utm_source=rss`)).toBe(normalizeUrl(plain));
    expect(normalizeUrl(`${base}?utm_source=rss&q=a%20b&sida=2`)).toBe(normalizeUrl(plain));
  });
});
