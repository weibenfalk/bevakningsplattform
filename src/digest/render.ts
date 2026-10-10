export interface DigestArticle {
  title: string;
  url: string;
  summary: string | null;
  urgency: string;
  otherSources: { url: string; source_name: string }[];
  /** En uppdatering av en story som redan funnits i ett utskick. */
  followUp?: boolean;
  /** Vilka av mottagarens egna profiler som träffade artikeln, och med vilka termer. */
  why?: { profile: string; terms: string[] }[];
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Bara http och https får bli länkar. Allt annat (javascript:, data:, relativa adresser) renderas inte. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const LINK = 'color:#12294D;font-weight:600;text-decoration:none';
const TEXT = 'color:#5A6473;font-size:14px;line-height:21px;margin:6px 0 0';

function renderItem(a: DigestArticle): string {
  const sources = a.otherSources
    .flatMap((s) => {
      const href = safeHref(s.url);
      return href ? [`<a href="${escapeHtml(href)}">${escapeHtml(s.source_name)}</a>`] : [];
    })
    .join(' · ');

  const why = (a.why ?? []).map((w) => `${escapeHtml(w.profile)} (${w.terms.map(escapeHtml).join(', ')})`).join(' · ');

  const href = safeHref(a.url);
  const title = href
    ? `<a href="${escapeHtml(href)}" style="${LINK}">${escapeHtml(a.title)}</a>`
    : `<span style="${LINK}">${escapeHtml(a.title)}</span>`;

  const label = a.followUp ? `<p style="${TEXT};font-size:12px;font-weight:600;text-transform:uppercase">Uppföljning</p>` : '';

  return `<tr><td style="padding:16px 24px">
    ${label}
    ${title}
    ${a.summary ? `<p style="${TEXT}">${escapeHtml(a.summary)}</p>` : ''}
    ${sources ? `<p style="${TEXT}">Även: ${sources}</p>` : ''}
    ${why ? `<p style="${TEXT}">Varför: ${why}</p>` : ''}
  </td></tr>`;
}

export function renderDigest(items: DigestArticle[]): string {
  return `<table role="presentation" width="640" cellpadding="0" cellspacing="0">
    ${items.map(renderItem).join('\n')}
  </table>`;
}
