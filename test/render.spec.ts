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

describe('renderDigest: artiklar utan rubrik', () => {
  it.each([
    ['tom rubrik och källa', '', 'Google-recensioner', '(ingen rubrik)</span><span style="color:#5A6473"> · Google-recensioner</span>'],
    ['bara blanksteg i rubriken', '   ', 'Facebookgrupper', '(ingen rubrik)</span><span style="color:#5A6473"> · Facebookgrupper</span>'],
    ['ingen källa', '', null, '(ingen rubrik)</span></a>'],
  ])('%s: "(ingen rubrik)" i grått, följt av källan, och länken har text', (_namn, title, source, forvantat) => {
    const html = renderDigest([article({ title, source })]);
    expect(html).toContain(forvantat);
    expect(html).toContain('<a href="https://example.se/a"');
    expect(html).not.toMatch(/<a [^>]*><\/a>/); // ingen tom, osynlig länk
  });

  it('en artikel med rubrik visar rubriken och inte "(ingen rubrik)", även om källan finns', () => {
    const html = renderDigest([article({ title: 'Rubrik', source: 'DI' })]);
    expect(html).toContain('>Rubrik</a>');
    expect(html).not.toContain('ingen rubrik');
  });

  it('källans namn escapas', () => {
    const html = renderDigest([article({ title: '', source: '<script>x</script>' })]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
