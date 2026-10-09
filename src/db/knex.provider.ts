import knex, { Knex } from 'knex';
import { resolveDatabaseUrl } from '../config/database';

export const KNEX = Symbol('KNEX');

export const knexProvider = {
  provide: KNEX,
  useFactory: (): Knex =>
    knex({
      client: 'pg',
      connection: resolveDatabaseUrl(),
      pool: { min: 0, max: 10 },
    }),
};
