/** Rubriken som länk. Saknas rubriken (Google-recensioner, Facebookinlägg) visas "(ingen rubrik)" i grått, följt av källans namn. */
export function ArticleTitle({ title, url, source }: { title: string; url: string; source: string | null }) {
  const missing = title.trim() === '';
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="hover:underline">
      {missing ? (
        <>
          <span className="text-muted-foreground">(ingen rubrik)</span>
          {source && <span className="text-muted-foreground"> · {source}</span>}
        </>
      ) : (
        title
      )}
    </a>
  );
}
