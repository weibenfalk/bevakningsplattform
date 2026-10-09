import { Knex } from 'knex';

/**
 * Återskapat schema: de tabeller och kolumner som den ärvda koden förutsätter.
 * Migrationerna saknades i startkoden. Det här är INTE den slutliga datamodellen,
 * bara det minimum som krävs för att köra den ärvda koden och visa hur den beter sig.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE content_scopes (
      user_id          text PRIMARY KEY,
      spaces           text[] NOT NULL,
      deny_categories  text[] NOT NULL DEFAULT '{}',
      deny_entities    text[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE entities (
      id            serial PRIMARY KEY,
      name          text NOT NULL UNIQUE,
      type          text,
      space         text,
      watch_level   text,
      org_number    text,
      domains       text[] NOT NULL DEFAULT '{}',
      aliases       text[] NOT NULL DEFAULT '{}',
      ceo_name      text,
      meta_page_id  text,
      notes         text
    );

    CREATE TABLE articles (
      id            serial PRIMARY KEY,
      raw_id        text NOT NULL UNIQUE,
      url           text NOT NULL,
      source_name   text,
      title         text NOT NULL,
      full_text     text,
      summary       text,
      spaces        text[] NOT NULL,
      urgency       text NOT NULL,
      impact        integer,
      confidence    real,
      relevance     integer,
      cluster_id    text,
      entity_ids    text[] NOT NULL DEFAULT '{}',
      categories    text[] NOT NULL DEFAULT '{}',
      published_at  timestamptz,
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('swedish', coalesce(title, '') || ' ' || coalesce(summary, ''))
      ) STORED
    );

    CREATE TABLE entity_matches (
      entity_id   text NOT NULL,
      article_id  integer NOT NULL REFERENCES articles(id),
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE entity_matches, articles, entities, content_scopes`);
}
