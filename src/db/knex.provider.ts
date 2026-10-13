import { ConfigService } from '@nestjs/config';
import knex, { Knex } from 'knex';
import { AppConfigService } from '../config/configuration';

export const KNEX = Symbol('KNEX');

export const knexProvider = {
  provide: KNEX,
  inject: [ConfigService],
  useFactory: (config: AppConfigService): Knex =>
    knex({
      client: 'pg',
      connection: config.get('databaseUrl', { infer: true }),
      pool: { min: 0, max: 10 },
    }),
};
