import { renderDigest } from '../src/digest/render';

const article = (extra: Record<string, unknown> = {}) => ({
  title: 'T', url: 'https://example.se/a', urgency: 'info', otherSources: [], summary: 's', ...extra,
});

describe('renderDigest: sammanfattningen är ren text', () => {
  it.each([
    ['Markdown tolkas inte, utan visas som den står', '**fet** [länk](javascript:alert(1))', ['<strong>', '<a href="javascript'], ['**fet**']],
    ['HTML i sammanfattningen escapas', '<img src=x onerror=alert(1)>', ['<img'], []],
    ['tecken som < och & escapas', 'a < b & c', [], ['a &lt; b &amp; c']],
  ])('%s', (_namn, summary, saknas, finns) => {
    const html = renderDigest([article({ summary })]);
    for (const text of saknas) expect(html).not.toContain(text);
    for (const text of finns) expect(html).toContain(text);
  });
});

describe('renderDigest: bara http- och https-länkar', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', '//evil.example', 'not a url'])(
    'huvudlänken %s renderas inte, men rubriken visas som text',
    (url) => {
      const html = renderDigest([article({ url, title: 'Rubrik' })]);
      expect(html).not.toMatch(/href="(?!https?:)/);
      expect(html).toContain('Rubrik');
    },
  );

  it('länkar i otherSources följer samma regel', () => {
    const html = renderDigest([article({ otherSources: [
      { url: 'javascript:alert(1)', source_name: 'Ond källa' },
      { url: 'https://bra.example.se/x', source_name: 'Bra källa' },
    ] })]);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://bra.example.se/x"');
    expect(html).toContain('Bra källa');
  });

  it('http och https renderas, och citattecken i adressen kan inte bryta ut ur attributet', () => {
    const html = renderDigest([article({ url: 'http://example.se/a?x="onmouseover="alert(1)' })]);
    expect(html).toContain('href="http://example.se/');
    expect(html).not.toContain('"onmouseover=');
  });
});
