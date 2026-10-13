import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { CLOCK, Clock } from '../config/clock';
import { pipelineConfig } from '../config/configuration';
import { KNEX } from '../db/knex.provider';
import { RunLogService } from '../runs/run-log.service';

export interface PurgeReport {
  /** Artiklar vars fulltext rensades. */
  articles: number;
  /** Överhoppade poster vars råpost rensades. */
  skippedItems: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rensar text som lagrats bara för bearbetning (specens avsnitt om datalagring: fulltext rensas efter 90 dagar).
 * Det gäller `articles.full_text` och `skipped_items.payload` (hela råposter). Artikeln, sammanfattningen, länken
 * och, för överhoppade poster, id, länk och orsak finns kvar.
 *
 * Gränsen räknas mot pipelinens klocka (`CLOCK`) och inte mot datorns. En post som är exakt 90 dagar gammal
 * behålls. Jobbet är idempotent: det rör bara rader som ännu har text. Steget loggas i pipeline_runs.
 *
 * Åldern är för en artikel den version som är sparad, alltså `updated_at` om källan uppdaterat den och annars
 * `published_at`. Saknas båda räknas den från `created_at`, när artikeln sparades: vid osäkerhet sparas mindre,
 * inte mer (fail closed). För en överhoppad post är åldern `created_at`. Pipelinen sätter `created_at` från
 * klockan för båda, så att demon och den fasta klockan beter sig likadant för artiklar och råposter.
 */
@Injectable()
export class PurgeService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly runs: RunLogService,
  ) {}

  async run(): Promise<PurgeReport> {
    return this.runs.record('purge', async (run) => {
      const cutoff = new Date(this.clock.now().getTime() - pipelineConfig.retention.days * DAY_MS);
      const report = await this.knex.transaction(async (trx) => {
        // Åldern är den sparade versionens tid (GREATEST ignorerar NULL) och annars när artikeln sparades.
        const articles = await trx('articles')
          .whereNotNull('full_text')
          .whereRaw('COALESCE(GREATEST(published_at, updated_at), created_at) < ?', [cutoff])
          .update({ full_text: null });
        // payload är NOT NULL, så en rensad råpost blir ett tomt objekt. `{}` är också det som visar att den redan är rensad.
        const skippedItems = await trx('skipped_items')
          .where('created_at', '<', cutoff)
          .whereRaw("payload <> '{}'::jsonb")
          .update({ payload: '{}' });
        return { articles, skippedItems };
      });
      run.set({ itemsOut: report.articles + report.skippedItems, ...report, cutoff: cutoff.toISOString() });
      return report;
    });
  }
}
