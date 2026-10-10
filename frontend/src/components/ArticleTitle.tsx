import { safeHref } from '@/lib/url';

/** Rubriken som länk. Saknas rubriken (Google-recensioner, Facebookinlägg) visas "(ingen rubrik)" i grått, följt av källans namn. Bara http(s)-adresser blir länkar. */
export function ArticleTitle({ title, url, source }: { title: string; url: string; source: string | null }) {
  const missing = title.trim() === '';
  const content = missing ? (
    <>
      <span className="text-muted-foreground">(ingen rubrik)</span>
      {source && <span className="text-muted-foreground"> · {source}</span>}
    </>
  ) : (
    title
  );
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="hover:underline">
      {content}
    </a>
  ) : (
    <span>{content}</span>
  );
}
