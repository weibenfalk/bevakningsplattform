import { z } from 'zod';

export const EnrichmentSchema = z.object({
  summary: z.string().max(600),
  business_areas: z.array(z.string()).default([]),
  urgency: z.enum(['akut', 'agera', 'bevaka', 'info']),
  impact: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
});

export type Enrichment = z.infer<typeof EnrichmentSchema>;
