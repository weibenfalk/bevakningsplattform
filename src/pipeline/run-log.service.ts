import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';

/** Stegen som loggar sina körningar (krav 7). */
export type PipelineStep = 'ingest' | 'enrich' | 'profile_match' | 'purge';

/**
 * Det ett steg rapporterar om sig självt. `itemsIn`, `itemsOut` och `itemsSkipped` har samma betydelse i alla steg
 * (hur många som kom in, hur många som kom ut och hur många som hoppades över). Allt annat sparas som det är i `details`.
 */
export interface RunCounts {
  itemsIn?: number;
  itemsOut?: number;
  itemsSkipped?: number;
  [extra: string]: unknown;
}

/** Stegets sätt att rapportera antal medan det kör. Det som är satt när steget går fel sparas också. */
export interface RunHandle {
  set(values: RunCounts): void;
}

export interface PipelineRun {
  id: number;
  step: PipelineStep;
  status: 'running' | 'ok' | 'failed';
  startedAt: Date;
  finishedAt: Date | null;
  itemsIn: number | null;
  itemsOut: number | null;
  itemsSkipped: number | null;
  error: string | null;
  /** Allt som steget rapporterade förutom antalen och felet. */
  details: Record<string, unknown>;
}

/**
 * Loggar varje körning av ett steg i `pipeline_runs`: start, slut, antal in, ut och överhoppade, och eventuellt fel.
 * Raden skapas med status `running` när steget börjar, så ett steg som aldrig blev klart (processen dog) syns i
 * stället för att försvinna. Antalen ligger i kolumnen `details`.
 */
@Injectable()
export class RunLogService {
  private readonly log = new Logger(RunLogService.name);

  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  /**
   * Kör `work` och loggar körningen. Ett fel sparas på raden och kastas vidare oförändrat, så loggningen
   * aldrig ändrar hur ett steg beter sig. Tid och klocka här är verklig tid (databasens `now()`), inte den
   * fasta klockan som styr färskhet i poängen.
   */
  async record<T>(step: PipelineStep, work: (run: RunHandle) => Promise<T>): Promise<T> {
    const [{ id }]: { id: number }[] = await this.knex('pipeline_runs').insert({ step, status: 'running' }).returning('id');
    const values: RunCounts = {};
    const handle: RunHandle = { set: (v) => Object.assign(values, v) };

    try {
      const result = await work(handle);
      await this.finish(id, 'ok', values);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.finish(id, 'failed', { ...values, error: message });
      } catch (logError) {
        // Det ursprungliga felet är det som räknas. Att loggen inte gick att spara får inte dölja det.
        this.log.error(`Kunde inte spara att steget ${step} misslyckades: ${logError instanceof Error ? logError.message : logError}`);
      }
      throw error;
    }
  }

  private async finish(id: number, status: 'ok' | 'failed', values: RunCounts): Promise<void> {
    await this.knex('pipeline_runs')
      .where({ id })
      .update({ status, finished_at: this.knex.fn.now(), details: JSON.stringify(values) });
  }

  /** Alla körningar, äldst först. */
  async list(): Promise<PipelineRun[]> {
    const rows: {
      id: number; step: PipelineStep; status: PipelineRun['status']; started_at: Date; finished_at: Date | null;
      details: RunCounts & { error?: string };
    }[] = await this.knex('pipeline_runs').select('*').orderBy('id');

    return rows.map(({ details, ...r }) => {
      const { itemsIn, itemsOut, itemsSkipped, error, ...rest } = details;
      return {
        id: r.id,
        step: r.step,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        itemsIn: itemsIn ?? null,
        itemsOut: itemsOut ?? null,
        itemsSkipped: itemsSkipped ?? null,
        error: error ?? null,
        details: rest,
      };
    });
  }
}
