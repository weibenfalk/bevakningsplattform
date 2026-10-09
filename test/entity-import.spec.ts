import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplicationContext } from '@nestjs/common';
import { EntityImportService } from '../src/import/entity-import.service';
import { closeTestingApp, createTestingApp, testKnex } from './helpers';

const HEADER = 'name,type,business_area,watch_level,org_number,hq_city,domains,aliases,ceo_name,meta_page_id,notes\n';

function csv(...rows: string[]): string {
  const path = join(mkdtempSync(join(tmpdir(), 'entiteter-')), 'e.csv');
  writeFileSync(path, HEADER + rows.join('\n') + '\n');
  return path;
}

describe('EntityImportService', () => {
  let app: INestApplicationContext;
  let importer: EntityImportService;
  beforeEach(async () => {
    app = await createTestingApp();
    importer = app.get(EntityImportService);
  });
  afterEach(closeTestingApp);

  const all = () => testKnex()('entities').select('*').orderBy('name');
  const byName = (name: string) => testKnex()('entities').where({ name }).first();

  describe('data/entiteter.csv', () => {
    it('importerar de sju riktiga entiteterna, utan EXEMPEL-raden, utan tomt namn och utan dubblett', async () => {
      const report = await importer.importCsv('data/entiteter.csv');
      expect((await all()).map((e) => e.name)).toEqual([
        'Blanka Fönster AB', 'Husfixarna', 'Klart Glas Kalmar', 'Rena Fönster',
        'Rikstak Sverige AB', 'Takteam i Sverige', 'Takvårdarna Småland AB',
      ]);
      expect(report.imported).toBe(7);
    });

    it('rapporterar avvisade rader med radnummer och orsak', async () => {
      const report = await importer.importCsv('data/entiteter.csv');
      expect(report.rejected.map((r) => r.line)).toEqual([2, 7]);
      expect(report.rejected[0].reason).toMatch(/EXEMPEL/i);
      expect(report.rejected[1].reason).toMatch(/namn/i);
    });

    it('slår ihop dubbletten Rikstak (efterföljande mellanslag) utan att tappa alias', async () => {
      const report = await importer.importCsv('data/entiteter.csv');
      const rows = await testKnex()('entities').whereRaw(`name ilike 'rikstak%'`);
      expect(rows).toHaveLength(1);
      expect([...rows[0].aliases].sort()).toEqual(['Riks Tak', 'Rikstak']);
      expect(report.merged).toBe(1);
    });

    it('mappar "Hög" till high och loggar mappningen i rapporten', async () => {
      const report = await importer.importCsv('data/entiteter.csv');
      expect((await byName('Klart Glas Kalmar')).watch_level).toBe('high');
      expect(report.mappings).toContainEqual({ line: 6, name: 'Klart Glas Kalmar', from: 'Hög', to: 'high' });
    });

    it('sparar meta_page_id som text utan att tappa siffror', async () => {
      await importer.importCsv('data/entiteter.csv');
      expect((await byName('Takvårdarna Småland AB')).meta_page_id).toBe('9007199254740993');
    });

    it('sparar inte vd-namn', async () => {
      await importer.importCsv('data/entiteter.csv');
      expect(JSON.stringify(await all())).not.toContain('Lena Holm');
      expect(Object.keys((await all())[0])).not.toContain('ceo_name');
    });

    it('lagrar inga tomma alias eller domäner', async () => {
      await importer.importCsv('data/entiteter.csv');
      for (const e of await all()) {
        expect([...e.aliases, ...e.domains].filter((t: string) => t.trim() === '')).toEqual([]);
      }
    });

    it('är idempotent och behåller alias som lagts till i databasen', async () => {
      await importer.importCsv('data/entiteter.csv');
      await testKnex().raw(`update entities set aliases = aliases || '{Extra}' where name = 'Rikstak Sverige AB'`);
      await importer.importCsv('data/entiteter.csv');
      const rows = await all();
      expect(rows).toHaveLength(7);
      expect([...(await byName('Rikstak Sverige AB')).aliases].sort()).toEqual(['Extra', 'Riks Tak', 'Rikstak']);
    });
  });

  describe('validering', () => {
    it('avvisar en okänd bevakningsnivå', async () => {
      const report = await importer.importCsv(csv('Ny AB,competitor,takvard,jättehög,,,x.se,Ny,,,'));
      expect(report.imported).toBe(0);
      expect(report.rejected[0].reason).toMatch(/bevakningsnivå/i);
    });

    it('avvisar ett okänt affärsområde', async () => {
      const report = await importer.importCsv(csv('Ny AB,competitor,bilar,high,,,x.se,Ny,,,'));
      expect(report.rejected[0].reason).toMatch(/affärsområde/i);
    });

    it('trimmar namn och termer', async () => {
      await importer.importCsv(csv('  Ny AB  ,competitor,takvard,high,,,  ny.se ,  Ny | Nya ,,,'));
      const e = await byName('Ny AB');
      expect(e.domains).toEqual(['ny.se']);
      expect([...e.aliases].sort()).toEqual(['Ny', 'Nya']);
    });
  });
});
