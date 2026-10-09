import knex, { Knex } from 'knex';
import { LOCAL_DATABASE_URL } from '../src/config/database';

/** Samma databas som docker-compose.yml startar, om inget annat anges. */
process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;

export const db = (): Knex => knex({ client: 'pg', connection: process.env.DATABASE_URL });
