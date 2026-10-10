import { readFileSync } from 'node:fs';
import { prepareItem } from '../src/pipeline/ingest';
import { RawItem } from '../src/types';

const read = (file: string): RawItem[] => JSON.parse(readFileSync(`data/${file}`, 'utf8'));

/**
 * Råposterna som `npm run query` söker i. Dag 1 är samma filer som demon läser (`raw_items.json` och
 * `raw_items_extra.json`), och dag 2 är `raw_items_dag2.json`. Teckenkodningen repareras som i pipelinen,
 * så att till exempel r20 ("FÃ¶nster") matchar "Fönster".
 */
export function loadQueryItems(): { day: 1 | 2; item: RawItem }[] {
  const day1 = [...read('raw_items.json'), ...read('raw_items_extra.json')];
  return [
    ...day1.map((item) => ({ day: 1 as const, item: prepareItem(item).item })),
    ...read('raw_items_dag2.json').map((item) => ({ day: 2 as const, item: prepareItem(item).item })),
  ];
}
