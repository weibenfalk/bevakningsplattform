import { readFileSync } from 'node:fs';
import { isCorrection } from '../src/pipeline/correction';
import { RawItem } from '../src/types';

const lasa = (fil: string): RawItem[] => JSON.parse(readFileSync(`data/${fil}`, 'utf8'));

describe('isCorrection: en rättelse känns igen på rubrik eller textens första ord', () => {
  it('d05 (rättelsen av rotavdraget) är en rättelse', () => {
    const d05 = lasa('raw_items_dag2.json').find((i) => i.id === 'd05')!;
    expect(isCorrection(d05)).toBe(true);
  });

  it('ingen annan post i testdatan är en rättelse', () => {
    const alla = [...lasa('raw_items.json'), ...lasa('raw_items_extra.json'), ...lasa('raw_items_dag2.json')];
    expect(alla.filter(isCorrection).map((i) => i.id)).toEqual(['d05']);
  });

  it.each([
    ['rubriken börjar med Rättelse', { title: 'Rättelse: rotavdraget', text: 'x' }],
    ['gemener', { title: 'rättelse till artikeln', text: 'x' }],
    ['plural', { title: 'Rättelser i dag', text: 'x' }],
    ['Korrigering', { title: 'Korrigering av uppgift', text: 'x' }],
    ['utan rubrik: texten börjar med Rättelse', { title: '', text: 'Rättelse: summan är 25 procent' }],
    ['inledande blanksteg och citattecken', { title: '  "Rättelse" – nytt belopp', text: 'x' }],
  ])('%s', (_namn, item) => {
    expect(isCorrection(item)).toBe(true);
  });

  it.each([
    ['ordet står inte först', { title: 'Ingen rättelse behövs', text: 'x' }],
    ['ett längre ord som börjar likadant', { title: 'Rättelsefonden öppnar', text: 'x' }],
    ['nämns först i texten', { title: 'Nya regler', text: 'Det här är ingen rättelse' }],
    ['tom post', { title: '', text: '' }],
  ])('%s är ingen rättelse', (_namn, item) => {
    expect(isCorrection(item)).toBe(false);
  });
});
