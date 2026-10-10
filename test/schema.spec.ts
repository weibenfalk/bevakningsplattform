import { createTestingApp, testKnex } from './helpers';

/** Krav 2 i specen: hela datamodellen, inklusive behörighet, finns från första migrationen. */
const KRAVDA: Record<string, string[]> = {
  workspaces: ['id', 'name'],
  users: ['id', 'name', 'role'],
  memberships: ['user_id', 'workspace_id'],
  profiles: ['id', 'owner_id', 'visibility'],
  profile_versions: ['profile_id', 'version', 'query'],
  profile_matches: ['profile_id', 'article_id', 'term', 'score'],
  publications: ['id', 'name', 'visibility'],
  sections: ['id', 'publication_id', 'profile_id'],
  subscriptions: ['user_id', 'publication_id'],
  editions: ['id', 'publication_id', 'status'],
  deliveries: ['id', 'edition_id', 'user_id'],
  feedback: ['id', 'delivery_id', 'article_id', 'vote'],
  pipeline_runs: ['id', 'step', 'started_at', 'status'],
};

describe('schemat (krav 2)', () => {
  beforeAll(async () => {
    await createTestingApp();
  });

  it.each(Object.entries(KRAVDA))('tabellen %s finns med sina kolumner', async (tabell, kolumner) => {
    const rows = await testKnex()('information_schema.columns').where({ table_schema: 'public', table_name: tabell }).select('column_name');
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual(expect.arrayContaining(kolumner));
  });

  it('rollen begränsas till specens sju roller', async () => {
    await expect(testKnex().raw(`INSERT INTO users (id, name, role) VALUES ('x', 'X', 'kung')`)).rejects.toThrow();
  });

  it('synligheten begränsas till privat, arbetsyta och organisation', async () => {
    await expect(
      testKnex().raw(`INSERT INTO profiles (id, owner_id, visibility) VALUES ('p', 'x', 'alla')`),
    ).rejects.toThrow();
  });
});
