import { Entity, EntityMatch } from '../types';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchEntities(text: string, entities: Entity[]): EntityMatch[] {
  const matches: EntityMatch[] = [];

  for (const entity of entities) {
    for (const term of [...entity.aliases, ...entity.domains]) {
      const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
      const hit = pattern.exec(text);
      if (!hit) continue;

      matches.push({
        entityId: entity.id,
        term,
        index: hit.index,
        confidence: entity.domains.includes(term) ? 1 : 0.9,
      });
    }
  }

  return matches;
}
