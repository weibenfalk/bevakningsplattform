import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../src/db/knex.provider';
import { bootstrap } from '../src/main';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { ProfileService } from '../src/profiles/profile.service';
import { RawItem } from '../src/types';
import { closeTestingApp, createTestingApp, testKnex, TEST_LOGGER } from './helpers';

const dag1: RawItem[] = ['raw_items.json', 'raw_items_extra.json'].flatMap((f) => JSON.parse(readFileSync(`data/${f}`, 'utf8')));

interface ProfileStatus {
  id: string;
  query: string;
  status: 'valid' | 'broken';
  error: { message: string; position?: number } | null;
  version: number | null;
  runningQuery: string | null;
  /** raw_id för träffarna i senaste körningen, och totalt. */
  lastRunMatches: string[];
  totalMatches: string[];
  /** Artiklar i senaste körningen som en NOT i frågan uteslöt. */
  excluded: { rawId: string; by: string }[];
}

interface StatusResponse {
  lastRun: { startedAt: string; pipelineNow: string | null } | null;
  profiles: ProfileStatus[];
}

describe('Admin: användarens profiler (GET /admin/users/:userId/profiles)', () => {
  let server: INestApplication;
  let base: string;
  const OLD_ADMINS = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    process.env.ADMIN_USER_IDS = 'u-mikael';
    const app = await createTestingApp();
    await app.get(PipelineService).run(dag1); // läser data/profiles.json, berikar och matchar profilerna
    server = await bootstrap({ port: 0, logger: TEST_LOGGER });
    base = `http://127.0.0.1:${(server.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.get<Knex>(KNEX).destroy();
    await server.close();
    await closeTestingApp();
    if (OLD_ADMINS === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD_ADMINS;
  });

  const get = (userId: string, caller?: string) =>
    fetch(`${base}/admin/users/${userId}/profiles`, { headers: caller ? { 'x-user-id': caller } : {} });
  const status = async (userId: string): Promise<StatusResponse> => (await (await get(userId, 'u-mikael')).json()) as StatusResponse;
  const profiles = async (userId: string): Promise<ProfileStatus[]> => (await status(userId)).profiles;
  const byId = (list: ProfileStatus[], id: string) => list.find((p) => p.id === id)!;

  test.each([['u-anna', 403], [undefined, 401]])('som %s ger %i', async (caller, status) => {
    const res = await get('u-kalle', caller);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain('pf-konkurrenter-tak');
  });

  it('en okänd användare ger 404', async () => {
    expect((await get('u-finns-inte', 'u-mikael')).status).toBe(404);
  });

  it('de två trasiga profilerna visas med sina fel och position, och utan version', async () => {
    const kalle = byId(await profiles('u-kalle'), 'pf-tak-pris');
    expect(kalle).toMatchObject({
      status: 'broken',
      query: '(Rikstak AND (takmålning OR taktvätt)',
      error: { message: "Parentesen '(' stängs aldrig (position 1)", position: 1 },
      version: null,
      runningQuery: null,
      totalMatches: [],
      lastRunMatches: [],
      excluded: [],
    });
    const anna = byId(await profiles('u-anna'), 'pf-puts');
    expect(anna).toMatchObject({ status: 'broken', query: '*putsning OR fallskydd', version: null });
    expect(anna.error!.message).toMatch(/Wildcard/);
    expect(anna.error!.position).toBe(1);
  });

  it('en giltig profil har fråga, version och inget fel, och bara användarens egna profiler visas', async () => {
    const kalle = await profiles('u-kalle');
    expect(kalle.map((p) => p.id).sort()).toEqual(['pf-konkurrenter-tak', 'pf-tak-pris']);
    expect(byId(kalle, 'pf-konkurrenter-tak')).toMatchObject({
      status: 'valid',
      query: '(Rikstak OR Takvårdarna OR "Taktvätt Syd") AND NOT pumpa*',
      error: null,
      version: 1,
    });
  });

  it('träffarna visas med raw_id, i senaste körningen och totalt, och stämmer med profile_matches', async () => {
    const rows: { raw_id: string }[] = await testKnex()('profile_matches as m').join('articles as a', 'a.id', 'm.article_id')
      .where('m.profile_id', 'pf-rena').distinct('a.raw_id').orderBy('a.raw_id');
    const rena = byId(await profiles('u-anna'), 'pf-rena');
    expect(rows.length).toBeGreaterThan(2);
    expect(rena.totalMatches).toEqual(rows.map((r) => r.raw_id));
    expect(rena.totalMatches).toEqual(expect.arrayContaining(['r06', 'r08']));
    expect(rena.lastRunMatches).toEqual(rena.totalMatches); // en enda körning hittills
  });

  it('en ny körning utan nya artiklar ger inga träffar i senaste körningen, men träffarna finns kvar, och körningens dag anges', async () => {
    const before = byId(await profiles('u-anna'), 'pf-rena');
    await new Promise((r) => setTimeout(r, 20)); // körningen ska starta efter de gamla träffarna
    const dag2 = new Date('2026-10-03T07:00:00+02:00');
    await server.get(PipelineService).run(dag1, { now: dag2 });
    const after = await status('u-anna');
    expect(byId(after.profiles, 'pf-rena')).toMatchObject({ lastRunMatches: [], totalMatches: before.totalMatches });
    expect(after.lastRun!.pipelineNow).toBe(dag2.toISOString());
  });

  it('läs-bart: anropet ändrar varken profiler, versioner eller träffar', async () => {
    const count = async () => Promise.all(['profiles', 'profile_versions', 'profile_matches'].map(async (t) => Number((await testKnex()(t).count('* as n'))[0].n)));
    const before = await count();
    await profiles('u-kalle');
    await profiles('u-anna');
    expect(await count()).toEqual(before);
  });

  it('en profil som blivit trasig i filen visas som trasig, och den äldre versionen som fortfarande körs anges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiler-'));
    const file = join(dir, 'profiles.json');
    const service = server.get(ProfileService);
    writeFileSync(file, JSON.stringify([{ id: 'pf-x', user: 'u-kalle', query: 'Rikstak' }]));
    await service.loadFromFile(file);
    writeFileSync(file, JSON.stringify([{ id: 'pf-x', user: 'u-kalle', query: '(Rikstak' }]));
    const status = (await service.statusFor('u-kalle', file)).profiles.find((p) => p.id === 'pf-x')!;
    expect(status).toMatchObject({ status: 'broken', query: '(Rikstak', version: 1, runningQuery: 'Rikstak' });
  });
});

describe('Admin: profilernas NOT uteslöt en artikel i senaste körningen', () => {
  let server: INestApplication;
  let base: string;
  const OLD_ADMINS = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    process.env.ADMIN_USER_IDS = 'u-mikael';
    const app = await createTestingApp();
    const dag2: RawItem[] = JSON.parse(readFileSync('data/raw_items_dag2.json', 'utf8'));
    await app.get(PipelineService).run(dag1, { now: new Date('2026-10-01T07:00:00+02:00') });
    await app.get(PipelineService).run(dag2, { now: new Date('2026-10-03T07:00:00+02:00') });
    server = await bootstrap({ port: 0, logger: TEST_LOGGER });
    base = `http://127.0.0.1:${(server.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.get<Knex>(KNEX).destroy();
    await server.close();
    await closeTestingApp();
    if (OLD_ADMINS === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD_ADMINS;
  });
  const profilesOf = async (userId: string): Promise<ProfileStatus[]> =>
    ((await (await fetch(`${base}/admin/users/${userId}/profiles`, { headers: { 'x-user-id': 'u-mikael' } })).json()) as StatusResponse).profiles;

  it('pf-regler: dag 2:s rättelse d05 uteslöts via NOT Rättelse, och den träffar inte', async () => {
    const regler = (await profilesOf('u-mikael')).find((p) => p.id === 'pf-regler')!;
    expect(regler.excluded).toEqual(expect.arrayContaining([{ rawId: 'd05', by: 'NOT Rättelse' }]));
    expect(regler.totalMatches).not.toContain('d05');
    expect(regler.lastRunMatches).not.toContain('d05');
  });

  it('bara artiklar i senaste körningen räknas, och en profil utan NOT har inget att utesluta', async () => {
    const mikael = await profilesOf('u-mikael');
    expect(mikael.find((p) => p.id === 'pf-koncern')!.excluded).toEqual([]);
    for (const p of [...mikael, ...(await profilesOf('u-kalle'))]) {
      for (const e of p.excluded) expect(e.rawId).toMatch(/^d\d+$/); // dag 2:s artiklar, inte dag 1:s
    }
  });
});
