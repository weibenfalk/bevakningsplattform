import { marked } from 'marked';

export interface DigestArticle {
  title: string;
  url: string;
  summary: string;
  urgency: string;
  otherSources: { url: string; source_name: string }[];
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LINK = 'color:#12294D;font-weight:600;text-decoration:none';
const TEXT = 'color:#5A6473;font-size:14px;line-height:21px;margin:6px 0 0';

function renderItem(a: DigestArticle): string {
  const sources = a.otherSources
    .map((s) => `<a href="${encodeURI(s.url)}">${escapeHtml(s.source_name)}</a>`)
    .join(' · ');

  return `<tr><td style="padding:16px 24px">
    <a href="${encodeURI(a.url)}" style="${LINK}">${escapeHtml(a.title)}</a>
    <p style="${TEXT}">${marked.parseInline(a.summary)}</p>
    ${sources ? `<p style="${TEXT}">Även: ${sources}</p>` : ''}
  </td></tr>`;
}

export function renderDigest(items: DigestArticle[]): string {
  return `<table role="presentation" width="640" cellpadding="0" cellspacing="0">
    ${items.map(renderItem).join('\n')}
  </table>`;
}
