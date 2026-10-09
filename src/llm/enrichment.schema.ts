import { z } from 'zod';
import { SPACES } from '../types';

/**
 * Fast lista över kategorier (specens avsnitt 1: regler, makro, säsong, konkurrenter, plus eget varumärke
 * och ovrigt). Modellen får bara välja ur den, så att `content_scopes.deny_categories` går att matcha exakt.
 * Utan å, ä och ö, eftersom värdena är nycklar och inte text som visas.
 */
export const CATEGORIES = ['regler', 'makro', 'sasong', 'konkurrent', 'eget_varumarke', 'ovrigt'] as const;
export type Category = (typeof CATEGORIES)[number];

export const EnrichmentSchema = z.object({
  summary: z.string().max(600),
  // Minst en giltig arbetsyta, ingen standard: ett svar utan arbetsyta är ogiltigt och får aldrig nå fler.
  business_areas: z.array(z.enum(SPACES)).min(1),
  // Minst en kategori, ingen standard: en artikel utan kategori kan inte filtreras av deny_categories.
  categories: z.array(z.enum(CATEGORIES)).min(1),
  urgency: z.enum(['akut', 'agera', 'bevaka', 'info']),
  impact: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
});

export type Enrichment = z.infer<typeof EnrichmentSchema>;
