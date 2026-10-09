import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

describe('arkitekturregler', () => {
  it('ingen kod utanför src/access läser innehållstabellerna direkt', () => {
    const offenders = globSync('src/**/*.ts', { ignore: 'src/access/**' }).filter((file) =>
      /\bfrom\s+(articles|signals|profile_matches)\b/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
