import knex, { Knex } from 'knex';

/** Samma databas som docker-compose.yml startar, om inget annat anges. */
process.env.DATABASE_URL ??= 'postgres://bevakning:bevakning@localhost:5433/bevakning';

export const db = (): Knex => knex({ client: 'pg', connection: process.env.DATABASE_URL });
