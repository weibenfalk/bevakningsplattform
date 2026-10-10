import { useQuery } from '@tanstack/react-query';
import { fetchProfiles, type ProfileStatus } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const articles = (ids: string[]) => `${ids.length} ${ids.length === 1 ? 'träff' : 'träffar'}${ids.length ? ` (${ids.join(', ')})` : ''}`;

/** "Uteslöt d05 via NOT Rättelse", en rad per villkor. */
function exclusions(profile: ProfileStatus): string[] {
  const byCondition = new Map<string, string[]>();
  for (const e of profile.excluded) byCondition.set(e.by, [...(byCondition.get(e.by) ?? []), e.rawId]);
  return [...byCondition].map(([by, ids]) => `Uteslöt ${ids.join(', ')} via ${by}`);
}

function ProfileCard({ profile, onTest }: { profile: ProfileStatus; onTest: (query: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {profile.id}
          <Badge variant={profile.status === 'valid' ? 'secondary' : 'destructive'}>{profile.status === 'valid' ? 'giltig' : 'trasig'}</Badge>
          <Badge variant="outline">{profile.version === null ? 'ingen version sparad' : `version ${profile.version}`}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <code className="break-words rounded-md bg-muted px-2 py-1 font-mono">{profile.query}</code>
        {profile.error && (
          <p role="alert" className="text-destructive">
            {profile.error.message}
            {profile.error.position !== undefined && !profile.error.message.includes('position') && ` (position ${profile.error.position})`}
          </p>
        )}
        {profile.runningQuery && (
          <p className="text-muted-foreground">
            Pipelinen kör fortfarande den äldre versionen: <code className="font-mono">{profile.runningQuery}</code>
          </p>
        )}
        <p className="text-muted-foreground">
          {articles(profile.totalMatches)}
        </p>
        {exclusions(profile).map((line) => <p key={line} className="text-muted-foreground">{line}</p>)}
        <Button className="self-start" onClick={() => onTest(profile.query)}>Testa i frågetestaren</Button>
      </CardContent>
    </Card>
  );
}

/** Användarens profiler, läs-bart. Knappen fyller i frågan i frågetestaren och kör den. */
export function ProfilesSection({ userId, onTest }: { userId: string; onTest: (query: string) => void }) {
  const profiles = useQuery({ queryKey: ['profiles', userId], queryFn: () => fetchProfiles(userId) });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Profiler</h2>
      {profiles.isPending && <p className="text-sm text-muted-foreground">Laddar profiler…</p>}
      {profiles.error && <p role="alert" className="text-sm text-destructive">Något gick fel: {profiles.error.message}</p>}
      {profiles.data?.profiles.length === 0 && <p className="text-sm text-muted-foreground">Användaren har inga profiler.</p>}
      {profiles.data?.profiles.map((p) => <ProfileCard key={p.id} profile={p} onTest={onTest} />)}
    </section>
  );
}
