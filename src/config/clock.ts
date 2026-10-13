import { DEFAULT_PIPELINE_NOW } from './configuration';

/**
 * Pipelinens klocka. Poängen räknas mot en fast tid och inte mot datorns klocka, så att körningar går att upprepa
 * (dag 1 = 2026-10-01 07:00 svensk tid, se CLAUDE.md). Byts mot systemklockan i produktion.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const fixedClock = (iso: string = DEFAULT_PIPELINE_NOW): Clock => ({
  now: () => new Date(iso),
});
