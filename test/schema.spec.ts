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
  deliveries: ['id', 'edition_id', 'user_id', 'sent_at'],
  feedback: ['id', 'delivery_id', 'article_id', 'vote'],
  pipeline_runs: ['id', 'step', 'started_at', 'status'],
  delivery_items: ['delivery_id', 'article_id'],
  articles: ['is_followup', 'is_correction', 'updated_at'],
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

describe('schemat: utskicksloggen använder editions, deliveries och delivery_items', () => {
  beforeAll(async () => {
    await createTestingApp();
  });

  it('tabellen sent_articles finns inte (loggen ligger i utgåvor och leveranser)', async () => {
    const rows = await testKnex()('information_schema.tables').where({ table_schema: 'public', table_name: 'sent_articles' });
    expect(rows).toEqual([]);
  });

  it('en artikel kan bara finnas en gång per leverans, och pekar på en riktig artikel och leverans', async () => {
    const knex = testKnex();
    await knex('users').insert({ id: 'u-x', name: 'x', role: 'reader' });
    await knex('publications').insert({ id: 'p', name: 'p', spaces: ['takvard'], schedule: 'varannan dag' });
    const [edition] = await knex('editions').insert({ publication_id: 'p', status: 'sent', sent_at: new Date() }).returning('id');
    const [delivery] = await knex('deliveries').insert({ edition_id: edition.id, user_id: 'u-x', sent_at: new Date() }).returning('id');
    const [article] = await knex('articles').insert({ raw_id: 's1', url: 'https://example.se/s1', title: 't', spaces: ['takvard'], urgency: 'info' }).returning('id');

    await knex('delivery_items').insert({ delivery_id: delivery.id, article_id: article.id });
    await expect(knex('delivery_items').insert({ delivery_id: delivery.id, article_id: article.id })).rejects.toThrow(/unique|duplicate/i);
    await expect(knex('delivery_items').insert({ delivery_id: delivery.id, article_id: 999999 })).rejects.toThrow(/foreign key/i);
    await expect(knex('delivery_items').insert({ delivery_id: 999999, article_id: article.id })).rejects.toThrow(/foreign key/i);
  });

  it('två utgåvor av samma publikation kan inte ha samma sändningstid', async () => {
    const knex = testKnex();
    const sentAt = new Date('2026-10-01T05:00:00Z');
    await knex('editions').insert({ publication_id: 'p', status: 'sent', sent_at: sentAt });
    await expect(knex('editions').insert({ publication_id: 'p', status: 'sent', sent_at: sentAt })).rejects.toThrow(/unique|duplicate/i);
  });
});
