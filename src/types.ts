export type Space = 'koncern' | 'takvard' | 'fonsterputs';
export type Urgency = 'akut' | 'agera' | 'bevaka' | 'info';
export type WatchLevel = 'critical' | 'high' | 'normal' | 'low';

export interface RawItem {
  id: string;
  source: string;
  url: string;
  published_at: string;
  updated_at?: string;
  title: string;
  text: string;
}

export interface Entity {
  id: string;
  name: string;
  watchLevel: WatchLevel;
  aliases: string[];
  domains: string[];
}

export interface EntityMatch {
  entityId: string;
  term: string;
  index: number;
  confidence: number;
}

export interface ScoredArticle {
  impact: number;
  confidence: number;
  urgency: Urgency;
  sourceWeight: number;
  publishedAt: string;
  entities: { id: string; watchLevel: WatchLevel }[];
  isTrending: boolean;
}
