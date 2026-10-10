// Components
import { ArticleTitle } from "./ArticleTitle";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
// Types
import type { Article } from "@/api";

const urgencyVariant = (urgency: string) => (urgency === 'akut' ? 'destructive' : urgency === 'agera' ? 'default' : 'secondary');

/** "Varför: profil (term, term) · profil (term)", eller inget alls när ingen profil träffade. */
const why = (a: Article) => a.profileMatches.map((m) => `${m.profileId} (${m.terms.join(', ')})`).join(' · ');

export function ArticleCard({ article }: { article: Article }) {
  const reason = why(article);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ArticleTitle title={article.title} url={article.url} source={article.source} />
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">Poäng {article.relevance ?? '–'}</Badge>
          <Badge variant={urgencyVariant(article.urgency)}>{article.urgency}</Badge>
          {article.spaces.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
          {article.categories.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {reason && <p className="text-muted-foreground">Varför: {reason}</p>}
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Så räknades poängen</summary>
          <div className="pt-2"><ScoreBreakdown breakdown={article.scoreBreakdown} /></div>
        </details>
      </CardContent>
    </Card>
  );
}