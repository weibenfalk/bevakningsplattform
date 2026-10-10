/**
 * Rensar fulltext och råposter som är äldre än 90 dagar (räknat mot pipelinens klocka). Säkert att köra flera gånger.
 *
 *   npm run purge
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Knex } from 'knex';
import { AppModule } from '../src/app.module';
import { KNEX } from '../src/db/knex.provider';
import { PurgeService } from '../src/pipeline/purge.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const report = await app.get(PurgeService).run();
    console.log(`Rensade fulltext i ${report.articles} artiklar och råposter i ${report.skippedItems} överhoppade poster.`);
  } finally {
    // knexProvider stänger inte sin pool, så vi gör det här (som demon).
    await app.get<Knex>(KNEX).destroy();
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
