import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { testQuery } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

/** Frågetestaren: skriv en profilfråga och se syntaxfel med position, eller träffarna inom vald användares omfång. */
export function QueryTester({ userId }: { userId: string | undefined }) {
  const [query, setQuery] = useState('');
  const test = useMutation({ mutationFn: () => testQuery(userId!, query) });
  const result = test.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Frågetestare</CardTitle>
        <p className="text-sm text-muted-foreground">
          Provar en profilfråga mot arkivet (samma text som profilmatchningen såg) inom {userId ? 'vald användares' : 'en vald användares'} omfång.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          aria-label="Profilfråga"
          placeholder='(Rikstak OR Takvårdarna) AND NOT pumpa*'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button className="self-start" disabled={!userId || !query.trim() || test.isPending} onClick={() => test.mutate()}>
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
        {result && 'matches' in result && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {result.matches.length} träffar bland {result.searched} artiklar.
              {result.withoutFullText > 0 && ` ${result.withoutFullText} saknar originaltext (rensad) och provades bara på rubrik och sammanfattning.`}
            </p>
            {result.matches.map((m) => (
              <div key={m.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <a href={m.url} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">{m.title}</a>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Poäng {m.relevance ?? '–'}</Badge>
                  <span className="text-muted-foreground">Term:</span>
                  {m.terms.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                  {m.textSource === 'summary' && <Badge variant="outline">bara rubrik och sammanfattning</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
