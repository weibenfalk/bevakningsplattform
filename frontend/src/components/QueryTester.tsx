import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { testQuery } from '@/api';
import { ArticleTitle } from '@/components/ArticleTitle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

/** Frågetestaren: skriv en profilfråga och se syntaxfel med position, eller träffarna inom vald användares omfång. */
export function QueryTester({ userId, userName, request }: { userId: string | undefined; userName: string | undefined; request?: { query: string; n: number } }) {
  const [query, setQuery] = useState('');
  const card = useRef<HTMLDivElement>(null);
  const test = useMutation({ mutationFn: (q: string) => testQuery(userId!, q) });

  // En profils knapp "Testa i frågetestaren": fyll i frågan, kör den och visa resultatet.
  useEffect(() => {
    if (!request || !userId) return;
    setQuery(request.query);
    test.mutate(request.query);
    card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);
  const result = test.data;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="query-tester-heading">
      <h2 id="query-tester-heading" className="text-lg font-semibold">Frågetestare</h2>
      <Card ref={card}>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            Provar en profilfråga mot hela arkivet (samma text som profilmatchningen såg) och visar om {userName ?? 'den valda användaren'} skulle få se träffarna.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="Profilfråga"
            placeholder='(Rikstak OR Takvårdarna) AND NOT pumpa*'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button className="self-start" disabled={!userId || !query.trim() || test.isPending} onClick={() => test.mutate(query)}>
            {test.isPending ? 'Provar…' : 'Prova frågan'}
          </Button>
          {!userId && <p className="text-sm text-muted-foreground">Välj en användare först.</p>}
          {test.error && <p role="alert" className="text-sm text-destructive">Något gick fel: {test.error.message}</p>}
          {result && 'syntaxError' in result && (
            <pre role="alert" className="overflow-x-auto rounded-md border border-destructive p-3 text-sm text-destructive">
              {/* Positionen räknas i den normaliserade texten, som i npm run query */}
              {`${query.normalize('NFC')}\n${' '.repeat(result.syntaxError.position - 1)}^\n${result.syntaxError.message}`}
            </pre>
          )}
        </CardContent>
      </Card>

      {result && 'matches' in result && (
        <section aria-labelledby="query-results-heading" className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-4">
          <h3 id="query-results-heading" className="font-semibold">Frågetestarens träffar</h3>
          <p className="text-sm font-medium">
            {result.matches.length} träffar i arkivet, varav {result.visibleCount} syns för {userName ?? userId}
          </p>
          <p className="text-sm text-muted-foreground">
            {result.searched} artiklar provades.
            {result.withoutFullText > 0 && ` ${result.withoutFullText} saknar originaltext (rensad) och provades bara på rubrik och sammanfattning.`}
          </p>
          {result.matches.map((m) => (
            <div key={m.id} className={`flex flex-col gap-1 rounded-md border bg-card p-3 text-sm ${m.visibleToUser ? '' : 'border-dashed'}`}>
              <span className="font-medium"><ArticleTitle title={m.title} url={m.url} source={m.source} /></span>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Poäng {m.relevance ?? '–'}</Badge>
                {m.spaces.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                <span className="text-muted-foreground">Term:</span>
                {m.terms.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                {m.textSource === 'summary' && <Badge variant="outline">bara rubrik och sammanfattning</Badge>}
              </div>
              {m.visibleToUser ? (
                <p className="text-emerald-600 dark:text-emerald-400">Syns för {userName ?? userId}</p>
              ) : (
                <div className="text-destructive">
                  <p>Syns inte för {userName ?? userId}:</p>
                  <ul className="list-disc pl-5">{m.hiddenReasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
