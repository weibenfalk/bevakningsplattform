import { Inject, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { readFile } from 'node:fs/promises';
import { Knex } from 'knex';
import { KNEX } from '../db/knex.provider';
import { SPACES, WatchLevel } from '../types';

const WATCH_LEVELS: readonly WatchLevel[] = ['critical', 'high', 'normal', 'low'];
/** Svenska skrivningar som mappas till den fasta listan. Varje mappning loggas i rapporten. */
const WATCH_LEVEL_ALIASES: Record<string, WatchLevel> = { kritisk: 'critical', hög: 'high', normal: 'normal', låg: 'low' };
const TYPES = ['competitor', 'own_brand'];

export interface ImportReport {
  imported: number;
  merged: number;
  rejected: { line: number; name: string; reason: string }[];
  mappings: { line: number; name: string; from: string; to: string }[];
}

interface CleanEntity {
  line: number;
  name: string;
  type: string | null;
  space: string;
  watch_level: WatchLevel;
  org_number: string | null;
  domains: string[];
  aliases: string[];
  meta_page_id: string | null;
  notes: string | null;
}

const terms = (value: unknown): string[] => [
  ...new Set(String(value ?? '').split('|').map((t) => t.trim()).filter(Boolean)),
];
const text = (value: unknown): string | null => String(value ?? '').trim() || null;

@Injectable()
export class EntityImportService {
  private readonly log = new Logger(EntityImportService.name);

  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  async importCsv(path: string): Promise<ImportReport> {
    const content = await readFile(path, 'utf8');
    // cast av: org_number och meta_page_id ska vara text. Ett stort id blir annars ett avrundat tal.
    const rows = parse<{ record: Record<string, string>; info: { lines: number } }>(content, {
      columns: true, skip_empty_lines: true, cast: false, info: true,
    });

    const report: ImportReport = { imported: 0, merged: 0, rejected: [], mappings: [] };
    const byKey = new Map<string, CleanEntity>();

    for (const { record: row, info } of rows) {
      const line = info.lines;
      const name = String(row.name ?? '').trim();
      const reject = (reason: string) => report.rejected.push({ line, name, reason });

      if (!name) { reject('Namn saknas'); continue; }
      if (/^exempel\b/i.test(name) || /exempelrad/i.test(row.notes ?? '')) { reject('EXEMPEL-rad'); continue; }

      const rawLevel = String(row.watch_level ?? '').trim();
      const level = WATCH_LEVELS.includes(rawLevel as WatchLevel)
        ? (rawLevel as WatchLevel)
        : WATCH_LEVEL_ALIASES[rawLevel.toLowerCase()];
      if (!level) { reject(`Okänd bevakningsnivå: "${rawLevel}"`); continue; }
      if (level !== rawLevel) report.mappings.push({ line, name, from: rawLevel, to: level });

      const space = String(row.business_area ?? '').trim();
      if (!(SPACES as readonly string[]).includes(space)) { reject(`Okänt affärsområde: "${space}"`); continue; }
      const type = text(row.type);
      if (type && !TYPES.includes(type)) { reject(`Okänd typ: "${type}"`); continue; }

      const clean: CleanEntity = {
        line, name, type, space, watch_level: level,
        org_number: text(row.org_number),
        domains: terms(row.domains),
        aliases: terms(row.aliases),
        meta_page_id: text(row.meta_page_id),
        notes: text(row.notes),
        // ceo_name läses medvetet inte in: personuppgifter som systemet inte behöver.
      };

      const key = name.toLowerCase();
      const earlier = byKey.get(key);
      if (earlier) {
        // Dubblett: slå ihop utan att tappa alias eller domäner, och behåll första radens övriga värden.
        earlier.aliases = [...new Set([...earlier.aliases, ...clean.aliases])];
        earlier.domains = [...new Set([...earlier.domains, ...clean.domains])];
        earlier.org_number ??= clean.org_number;
        earlier.meta_page_id ??= clean.meta_page_id;
        earlier.notes ??= clean.notes;
        report.merged++;
      } else {
        byKey.set(key, clean);
      }
    }

    for (const e of byKey.values()) {
      const { line: _line, ...columns } = e;
      await this.knex('entities')
        .insert(columns)
        .onConflict('name')
        .merge({
          // Slå ihop med det som redan finns i stället för att skriva över.
          aliases: this.knex.raw('ARRAY(SELECT DISTINCT unnest(entities.aliases || EXCLUDED.aliases))'),
          domains: this.knex.raw('ARRAY(SELECT DISTINCT unnest(entities.domains || EXCLUDED.domains))'),
          type: this.knex.raw('COALESCE(EXCLUDED.type, entities.type)'),
          space: this.knex.raw('EXCLUDED.space'),
          watch_level: this.knex.raw('EXCLUDED.watch_level'),
          org_number: this.knex.raw('COALESCE(EXCLUDED.org_number, entities.org_number)'),
          meta_page_id: this.knex.raw('COALESCE(EXCLUDED.meta_page_id, entities.meta_page_id)'),
          notes: this.knex.raw('COALESCE(EXCLUDED.notes, entities.notes)'),
        });
      report.imported++;
    }

    for (const m of report.mappings) this.log.log(`Rad ${m.line} (${m.name}): bevakningsnivå "${m.from}" mappad till "${m.to}"`);
    for (const r of report.rejected) this.log.warn(`Rad ${r.line} avvisad (${r.name || 'utan namn'}): ${r.reason}`);
    this.log.log(`Importerade ${report.imported} entiteter, ${report.merged} dubbletter ihopslagna, ${report.rejected.length} avvisade`);
    return report;
  }
}
