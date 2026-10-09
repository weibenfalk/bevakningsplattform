import { Entity, EntityMatch } from '../types';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ordgräns som förstår Unicode. `\b` räknar å, ä och ö som icke-bokstäver och ger fel träffar. */
const NOT_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_AFTER = '(?![\\p{L}\\p{N}])';

/** Termens blanksteg får vara flera blanksteg eller radbrytningar i texten. */
const termSource = (term: string) => escapeRegExp(term.trim()).replace(/\s+/g, '\\s+');

/**
 * Alias matchas skiftlägeskänsligt, med valfritt genitiv-s ("Takvårdarnas"). Många varumärken är också vanliga ord
 * ("Rena Fönster", "Klart Glas", "Tak Team"), och "rena fönster" i ett städtips ska inte träffa varumärket.
 * Avvägning: ett varumärke som skrivs med gemener eller versaler ("RIKSTAK") missas. Domäner är alltid
 * gemener i praktiken och matchas därför oberoende av skiftläge.
 */
const aliasPattern = (term: string) => new RegExp(`${NOT_BEFORE}${termSource(term)}s?${NOT_AFTER}`, 'u');
const domainPattern = (term: string) => new RegExp(`${NOT_BEFORE}${termSource(term)}${NOT_AFTER}`, 'iu');

export function matchEntities(text: string, entities: Entity[]): EntityMatch[] {
  const matches: EntityMatch[] = [];

  for (const entity of entities) {
    const terms = [
      ...entity.aliases.map((term) => ({ term, pattern: aliasPattern, confidence: 0.9 })),
      ...entity.domains.map((term) => ({ term, pattern: domainPattern, confidence: 1 })),
    ];
    for (const { term, pattern, confidence } of terms) {
      // En tom term ger ett mönster som matchar all text. Hoppa över den.
      if (term.trim() === '') continue;
      const hit = pattern(term).exec(text);
      if (!hit) continue;

      matches.push({ entityId: entity.id, term, index: hit.index, confidence });
    }
  }

  return matches;
}
