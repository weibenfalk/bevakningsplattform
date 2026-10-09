import { Inject, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { readFile } from 'node:fs/promises';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';

@Injectable()
export class EntityImportService {
  private readonly log = new Logger(EntityImportService.name);

  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  async importCsv(path: string): Promise<number> {
    const content = await readFile(path, 'utf8');
    // Typen lades till vid uppgradering av csv-parse (nyare versioner returnerar unknown). Logiken är orörd.
    const rows = parse<Record<string, any>>(content, { columns: true, skip_empty_lines: true, cast: true });

    let imported = 0;
    for (const row of rows) {
      if (!row.name) continue;

      await this.knex('entities')
        .insert({
          name: row.name,
          type: row.type,
          space: row.business_area,
          watch_level: row.watch_level,
          org_number: row.org_number || null,
          domains: String(row.domains ?? '').split('|'),
          aliases: String(row.aliases ?? '').split('|'),
          ceo_name: row.ceo_name || null,
          meta_page_id: row.meta_page_id || null,
          notes: row.notes || null,
        })
        .onConflict('name')
        .merge(['aliases', 'domains']);
      imported++;
    }

    this.log.log(`Importerade ${imported} entiteter`);
    return imported;
  }
}
