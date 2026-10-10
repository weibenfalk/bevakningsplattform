import React from 'react';
import { useQuery } from '@tanstack/react-query';
// Api
import { fetchUsers, fetchViewAs } from '@/api';
// Components
import { ErrorBox } from './components/ErrorBox';
import { ProfilesSection } from '@/components/ProfilesSection';
import { QueryTester } from '@/components/QueryTester';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArticleCard } from './components/ArticleCard';

export default function App() {
  const [userId, setUserId] = React.useState<string>();
  const [testRequest, setTestRequest] = React.useState<{ query: string; n: number }>();
  const users = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  const view = useQuery({ queryKey: ['view-as', userId], queryFn: () => fetchViewAs(userId!), enabled: !!userId });
  // Högst poäng först. Artiklar utan poäng sist.
  const articles = [...(view.data?.articles ?? [])].sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Visa som användare</h1>
        <p className="text-sm text-muted-foreground">Läsbart adminverktyg. Visar vad användaren ser, och varför.</p>
      </header>

      <Select
        value={userId}
        onValueChange={(id) => {
          setUserId(id);
          setTestRequest(undefined); // en fråga som provades för förra användaren ska inte köras om för den nya
        }}
        disabled={!users.data}
      >
        <SelectTrigger aria-label="Välj användare">
          <SelectValue placeholder={users.isPending ? 'Laddar användare…' : 'Välj användare'} />
        </SelectTrigger>
        <SelectContent>
          {users.data?.map((u) => (
            <SelectItem key={u.id} value={u.id}>{u.name}{u.role ? ` – ${u.role}` : ''}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {users.error && <ErrorBox error={users.error} />}

      {userId && <ProfilesSection userId={userId} onTest={(query) => setTestRequest((prev) => ({ query, n: (prev?.n ?? 0) + 1 }))} />}

      <QueryTester key={userId} userId={userId} userName={users.data?.find((u) => u.id === userId)?.name} request={testRequest} />

      {view.isFetching && <p className="text-sm text-muted-foreground">Laddar artiklar…</p>}
      {view.error && <ErrorBox error={view.error} />}

      {view.data && !view.isFetching && (
        <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby="articles-heading">
          <h2 id="articles-heading" className="text-lg font-semibold">Artiklar {view.data.user.name} ser ({articles.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Arbetsytor:</span>
            {view.data.user.spaces.map((s) => <Badge key={s}>{s}</Badge>)}
          </div>
          {articles.length === 0 && <p className="text-sm text-muted-foreground">Inga artiklar inom användarens omfång.</p>}
          {articles.map((a) => <ArticleCard key={a.id} article={a} />)}
        </section>
      )}
    </main>
  );
}
