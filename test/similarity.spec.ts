import { pipelineConfig } from '../src/config/pipeline.config';
import { StubProvider } from '../src/llm/stub.provider';
import { isSameStory, similarity } from '../src/pipeline/similarity';

describe('similarity: riktig cosinuslikhet', () => {
  it('identiska vektorer ger 1, även när de inte har längd 1 (stubbens vektorer har det inte)', () => {
    expect(similarity([3, 4], [3, 4])).toBeCloseTo(1, 12);
    expect(similarity([3, 4], [6, 8])).toBeCloseTo(1, 12);
  });

  it('ortogonala vektorer ger 0 och motsatta ger -1', () => {
    expect(similarity([1, 0], [0, 5])).toBeCloseTo(0, 12);
    expect(similarity([2, 0], [-7, 0])).toBeCloseTo(-1, 12);
  });

  it('ger rätt värde för ett känt fall', () => {
    expect(similarity([1, 0], [1, 1])).toBeCloseTo(Math.SQRT1_2, 12);
    expect(similarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(32 / (Math.sqrt(14) * Math.sqrt(77)), 12);
  });

  it('är symmetrisk, oberoende av vektorernas längd och alltid mellan -1 och 1', () => {
    const a = [0.3, -1.2, 5, 0];
    const b = [2, 0.1, 4, -3];
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 12);
    expect(similarity(a.map((x) => x * 1000), b)).toBeCloseTo(similarity(a, b), 12);
    for (const v of [similarity(a, a), similarity(a, b), similarity(a, a.map((x) => -x))]) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('nollvektorer, tomma vektorer och icke-tal ger 0 (aldrig NaN, som annars aldrig faller på rätt sida)', () => {
    expect(similarity([0, 0], [1, 2])).toBe(0);
    expect(similarity([], [])).toBe(0);
    expect(similarity([Number.NaN, 1], [1, 1])).toBe(0);
    expect(similarity([Number.POSITIVE_INFINITY, 1], [1, 1])).toBe(0);
  });

  it('vektorer med olika längd är ett fel och räknas inte tyst (olika embeddingmodeller går inte att jämföra)', () => {
    expect(() => similarity([1, 2, 3], [1, 2])).toThrow(RangeError);
  });
});

describe('isSameStory', () => {
  const stub = new StubProvider();
  const threshold = pipelineConfig.dedupe.sameStoryThreshold;

  it('två orelaterade texter räknas inte som samma story (fel 11)', async () => {
    const a = await stub.embed('Rotavdraget sänks från 30 till 20 procent av arbetskostnaden för arbeten');
    const b = await stub.embed('Erik Eriksson från Nybro vann årets pumpatävling med en pumpa på 412 kilo');
    expect(isSameStory(a, b)).toBe(false);
  });

  it('tröskeln är inklusive: exakt tröskelvärdet räknas som samma story', () => {
    const angle = Math.acos(threshold);
    expect(isSameStory([1, 0], [Math.cos(angle), Math.sin(angle)])).toBe(true);
    expect(isSameStory([1, 0], [Math.cos(angle + 0.01), Math.sin(angle + 0.01)])).toBe(false);
  });
});
