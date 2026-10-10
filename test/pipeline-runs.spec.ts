import { INestApplicationContext } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { LlmProvider } from '../src/llm/llm.provider';
import { EnrichService } from '../src/pipeline/enrich.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { RunLogService } from '../src/pipeline/run-log.service';
import { ProfileService } from '../src/profiles/profile.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, installLlm, scriptedLlm, testKnex } from './helpers';

const lasa = (fil: string): RawItem[] => JSON.parse(readFileSync(`data/${fil}`, 'utf8'));
/** Dag 1 så som demon läser den: 23 råposter. */
const dag1 = () => [...lasa('raw_items.json'), ...lasa('raw_items_extra.json')];

describe('pipeline_runs: alla steg loggar sina körningar (krav 7)', () => {
  let app: INestApplicationContext;
  beforeEach(async () => { app = await createTestingApp(); });
  afterEach(closeTestingApp);

  const runs = () => app.get(RunLogService).list();
  const count = async (table: string) => Number((await testKnex()(table).count<{ count: string }>('* as count').first())?.count);

  it('en körning sparar ett steg för inläsning, berikning och profilmatchning, i ordning', async () => {
    await app.get(PipelineService).run(dag1());
    expect((await runs()).map((r) => [r.step, r.status])).toEqual([
      ['ingest', 'ok'],
      ['enrich', 'ok'],
      ['profile_match', 'ok'],
    ]);
  });

  it('varje steg har start och slut, och slutet är inte före starten', async () => {
    await app.get(PipelineService).run(dag1());
    for (const run of await runs()) {
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.finishedAt).toBeInstanceOf(Date);
      expect(run.finishedAt!.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime());
      expect(run.error).toBeNull();
    }
  });

  it('inläsningen räknar in, ut och överhoppade (r03 är en dubblett av r01, och den andra r09 krockar)', async () => {
    await app.get(PipelineService).run(dag1());
    const ingest = (await runs()).find((r) => r.step === 'ingest')!;
    expect(ingest).toMatchObject({ itemsIn: 23, itemsOut: 21, itemsSkipped: 2 });
    expect(ingest.details).toMatchObject({ alreadyStored: 0 });
  });

  it('berikningen räknar in (nya poster), ut (sparade artiklar) och överhoppade (sållade bort)', async () => {
    await app.get(PipelineService).run(dag1());
    const enrich = (await runs()).find((r) => r.step === 'enrich')!;
    expect(enrich.itemsIn).toBe(21);
    expect(enrich.itemsOut).toBe(await count('articles'));
    expect(enrich.itemsIn).toBe(enrich.itemsOut! + enrich.itemsSkipped!);
  });

  it('profilmatchningen räknar artiklar in, sparade träffar ut och profiler som hoppades över', async () => {
    await app.get(PipelineService).run(dag1());
    const match = (await runs()).find((r) => r.step === 'profile_match')!;
    expect(match.itemsIn).toBe(21);
    expect(match.itemsOut).toBe(await count('profile_matches'));
    expect(match.itemsOut).toBeGreaterThan(0);
    expect(match.itemsSkipped).toBe(0);
    expect(match.details).toMatchObject({ profilesRun: 4 });
  });

  it('en omkörning loggas också: nya rader, ingenting nytt in, och posterna räknas som redan sparade', async () => {
    const pipeline = app.get(PipelineService);
    await pipeline.run(dag1());
    await pipeline.run(dag1());
    const alla = await runs();
    expect(alla).toHaveLength(6);
    const [ingest, enrich, match] = alla.slice(3);
    expect(ingest).toMatchObject({ itemsIn: 23, itemsOut: 0, itemsSkipped: 2 });
    expect(ingest.details).toMatchObject({ alreadyStored: 21 });
    expect(ingest.itemsIn).toBe(ingest.itemsOut! + ingest.itemsSkipped! + (ingest.details.alreadyStored as number));
    expect(enrich).toMatchObject({ itemsIn: 0, itemsOut: 0, itemsSkipped: 0 });
    expect(match).toMatchObject({ itemsIn: 0, itemsOut: 0 });
  });

  it('stegen loggar även när de anropas direkt, inte bara via PipelineService', async () => {
    await app.get(EnrichService).run(dag1());
    expect((await runs()).map((r) => r.step)).toEqual(['ingest', 'enrich']);
  });

  it('ett pågående steg syns som running medan det körs', async () => {
    const base = scriptedLlm({ enrich: { summary: 's', business_areas: ['takvard'], categories: ['ovrigt'], urgency: 'info', impact: 50, confidence: 0.8 } });
    let sett: string | undefined;
    const spion: LlmProvider = {
      embed: base.embed,
      complete: async (req) => {
        if (req.task === 'enrich') sett ??= (await testKnex()('pipeline_runs').where({ step: 'enrich' }).first())?.status;
        return base.complete(req);
      },
    };
    installLlm(app, spion);
    await app.get(EnrichService).run(dag1().slice(0, 2));
    expect(sett).toBe('running');
    expect((await runs()).find((r) => r.step === 'enrich')!.status).toBe('ok');
  });

  describe('fel', () => {
    const felande = (): LlmProvider => {
      const base = scriptedLlm({ enrich: {} });
      return {
        embed: base.embed,
        complete: async (req) => {
          if (req.task === 'triage') return base.complete(req);
          throw new Error('AI-tjänsten svarar inte');
        },
      };
    };

    it('ett fel i berikningen sparas på steget, med antalen hittills, och kastas vidare', async () => {
      installLlm(app, felande());
      await expect(app.get(PipelineService).run(dag1())).rejects.toThrow('AI-tjänsten svarar inte');

      const alla = await runs();
      expect(alla.map((r) => [r.step, r.status])).toEqual([
        ['ingest', 'ok'],
        ['enrich', 'failed'],
      ]);
      const enrich = alla[1];
      expect(enrich.error).toBe('AI-tjänsten svarar inte');
      expect(enrich.finishedAt).toBeInstanceOf(Date);
      expect(enrich.itemsIn).toBe(21);
    });

    it('ett fel i profilmatchningen sparas på steget, och de tidigare stegen är kvar som ok', async () => {
      jest.spyOn(app.get(ProfileService), 'activeProfiles').mockRejectedValue(new Error('databasen är nere'));
      await expect(app.get(PipelineService).run(dag1())).rejects.toThrow('databasen är nere');
      const alla = await runs();
      expect(alla.map((r) => [r.step, r.status])).toEqual([
        ['ingest', 'ok'],
        ['enrich', 'ok'],
        ['profile_match', 'failed'],
      ]);
      expect(alla[2].error).toBe('databasen är nere');
      expect(alla[2].itemsIn).toBe(21);
    });

    it('ett steg som misslyckas lämnar inget running-steg efter sig', async () => {
      installLlm(app, felande());
      await expect(app.get(PipelineService).run(dag1())).rejects.toThrow();
      expect((await runs()).filter((r) => r.status === 'running')).toEqual([]);
    });

    it('om loggen inte går att spara efter ett fel är det ursprungliga felet det som kastas', async () => {
      installLlm(app, felande());
      // Bara sparandet av ett misslyckat steg faller. Den lyckade inläsningen före sparas som vanligt.
      const log = app.get(RunLogService) as unknown as { finish: (id: number, status: string, values: object) => Promise<void> };
      const finish = log.finish.bind(log);
      jest.spyOn(log, 'finish').mockImplementation((id, status, values) =>
        status === 'failed' ? Promise.reject(new Error('loggen gick inte att spara')) : finish(id, status, values));
      await expect(app.get(PipelineService).run(dag1())).rejects.toThrow('AI-tjänsten svarar inte');
    });
  });
});
