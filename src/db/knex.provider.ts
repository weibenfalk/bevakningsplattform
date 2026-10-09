import knex, { Knex } from 'knex';

export const KNEX = Symbol('KNEX');

export const knexProvider = {
  provide: KNEX,
  useFactory: (): Knex =>
    knex({
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 0, max: 10 },
    }),
};
