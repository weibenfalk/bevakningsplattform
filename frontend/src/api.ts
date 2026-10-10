// Platshållare för inloggning: servern litar på x-user-id (se README). Verktyget är bara för admin.
const ADMIN_USER_ID = import.meta.env.VITE_ADMIN_USER_ID ?? 'u-mikael';

export interface AdminUser {
  id: string;
  name: string;
  role: string | null;
  spaces: string[];
}

export interface ScoreBreakdown {
  components: { key: string; label: string; input: number; weight: number; points: number }[];
  base: number;
  factors: { key: string; label: string; multiplier: number }[];
  score: number;
}

export interface Article {
  id: number;
  title: string;
  url: string;
  /** Källans namn, eller id:t om namnet saknas. */
  source: string | null;
  relevance: number | null;
  /** `null` för artiklar som sparades innan uppdelningen fanns. */
  scoreBreakdown: ScoreBreakdown | null;
  urgency: string;
  spaces: string[];
  categories: string[];
  profileMatches: { profileId: string; terms: string[] }[];
}

export interface ViewAs {
  user: AdminUser;
  articles: Article[];
}

export interface ProfileStatus {
  id: string;
  query: string;
  status: 'valid' | 'broken';
  error: { message: string; position?: number } | null;
  /** `null` om profilen aldrig sparats (trasig från början). */
  version: number | null;
  /** Frågan pipelinen faktiskt kör, om den skiljer sig från frågan i filen. */
  runningQuery: string | null;
  /** raw_id för artiklarna profilen träffade i senaste körningen, och totalt. */
  lastRunMatches: string[];
  totalMatches: string[];
  /** Artiklar i senaste körningen som en NOT i frågan uteslöt. */
  excluded: { rawId: string; by: string }[];
}

export interface ProfilesResponse {
  lastRun: { startedAt: string; pipelineNow: string | null } | null;
  profiles: ProfileStatus[];
}

export type QueryTestResult =
  | { syntaxError: { message: string; position: number } }
  | {
      matches: {
        id: number;
        title: string;
        url: string;
        source: string | null;
        relevance: number | null;
        spaces: string[];
        terms: string[];
        textSource: 'fulltext' | 'summary';
        visibleToUser: boolean;
        hiddenReasons: string[];
      }[];
      visibleCount: number;
      searched: number;
      withoutFullText: number;
    };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-user-id': ADMIN_USER_ID, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const message = res.status === 403 ? 'Bara admin får använda verktyget. Starta servern med npm run start:admin.' : res.statusText;
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json() as Promise<T>;
}

export const fetchUsers = () => request<AdminUser[]>('/admin/users');
export const fetchViewAs = (userId: string) => request<ViewAs>(`/admin/view-as/${encodeURIComponent(userId)}`);
export const fetchProfiles = (userId: string) =>
  request<ProfilesResponse>(`/admin/users/${encodeURIComponent(userId)}/profiles`);
export const testQuery = (userId: string, query: string) => request<QueryTestResult>('/admin/query-test', { userId, query });
