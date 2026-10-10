import { RawItem } from '../types';

/** Första orden som gör en post till en rättelse. */
const CORRECTION_WORDS = ['rättelse', 'rättelser', 'korrigering', 'korrigeringar'];

const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();

/** Första ordet i en text, med gemener. Inledande blanksteg, citattecken och liknande hoppas över. */
function firstWord(text: string): string {
  let i = 0;
  while (i < text.length && !isLetter(text[i])) i++;
  let word = '';
  while (i < text.length && isLetter(text[i])) word += text[i++];
  return word.toLowerCase();
}

/**
 * Är posten en rättelse av något som tidigare publicerats? Det avgörs av rubrikens eller textens första ord
 * ("Rättelse: rotavdraget sänks till 25 procent …"), inte av AI:n: en rättelse av en regeländring får inte
 * missas för att modellen bedömde den fel, och en falsk rättelse kostar bara en artikel extra i utskicket.
 */
export function isCorrection(item: Pick<RawItem, 'title' | 'text'>): boolean {
  return [item.title, item.text].some((t) => CORRECTION_WORDS.includes(firstWord(t)));
}
