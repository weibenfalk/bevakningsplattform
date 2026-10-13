import { Global, Module } from '@nestjs/common';
import { KNEX, knexProvider } from './knex.provider';

/** Databasanslutningen (Knex), global eftersom nästan alla moduler behöver den. */
@Global()
@Module({ providers: [knexProvider], exports: [KNEX] })
export class DatabaseModule {}
