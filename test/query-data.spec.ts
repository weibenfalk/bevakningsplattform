import { readFileSync } from 'node:fs';
import { loadQueryItems } from '../scripts/query-data';

const ids = (day: number) => loadQueryItems().filter((i) => i.day === day).map((i) => i.item.id);

describe('loadQueryItems: samma data som demon', () => {
  it('dag 1 är raw_items.json + raw_items_extra.json i demons ordning, och dag 2 är raw_items_dag2.json', () => {
    const expected = [
      ...JSON.parse(readFileSync('data/raw_items.json', 'utf8')),
      ...JSON.parse(readFileSync('data/raw_items_extra.json', 'utf8')),
    ].map((r: { id: string }) => r.id);
    expect(ids(1)).toEqual(expected);
    expect(ids(1)).toEqual(expect.arrayContaining(['r19', 'r20', 'r21', 'r22']));
    expect(ids(2)).toEqual(['d01', 'd02', 'd03', 'd04', 'd05', 'd06']);
  });

  it('felkodad text repareras som i pipelinen (r20)', () => {
    const r20 = loadQueryItems().find((i) => i.item.id === 'r20')!;
    expect(r20.item.title).toBe('Blanka Fönster expanderar');
  });
});
