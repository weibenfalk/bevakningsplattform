import { Knex } from 'knex';

/**
 * Hela datamodellen (specens krav 2: inklusive behörighet, från första migrationen).
 * Migrationerna saknades i startkoden. Tabellerna överst är de som den ärvda koden använder.
 * De under "Behörighet, profiler och utskick" används inte av koden än. De finns för att
 * schemat inte ska behöva byggas om när frågespråket, profilmatchningen och utskicken kopplas in.
 * Den gamla `content_scopes` används fortfarande för omfånget, och ersätts av memberships i ett senare steg.
 * Kolumnerna är en rimlig första tolkning av specen och inte provade mot kod, så förvänta dig justeringar.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE content_scopes (
      user_id          text PRIMARY KEY,
      spaces           text[] NOT NULL,
      -- Tom tillåtelselista = ingen begränsning utöver arbetsytan. Nekat vinner alltid över tillåtet (specens avsnitt 2).
      allow_categories text[] NOT NULL DEFAULT '{}',
      allow_sources    text[] NOT NULL DEFAULT '{}',
      allow_entities   text[] NOT NULL DEFAULT '{}',
      deny_categories  text[] NOT NULL DEFAULT '{}',
      deny_sources     text[] NOT NULL DEFAULT '{}',
      deny_entities    text[] NOT NULL DEFAULT '{}',
      -- Högsta brådska användaren får se (akut > agera > bevaka > info). NULL = alla. Ett okänt värde avvisas av ContentScopeService (fail closed).
      max_urgency      text
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
      meta_page_id  text,
      notes         text
    );

    CREATE TABLE articles (
      id            serial PRIMARY KEY,
      raw_id        text NOT NULL UNIQUE,
      -- Den normaliserade URL:en är artikelns identitet. raw_id kommer från källan och är inte pålitligt (r09 förekommer två gånger).
      url           text NOT NULL UNIQUE,
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
      -- Hash av titel och text, för att avgöra om en post med samma URL har ändrats utan att läsa full_text.
      content_hash  text,
      needs_review  boolean NOT NULL DEFAULT false,
      review_reason text,
      published_at  timestamptz,
      -- När artikeln sparades, enligt pipelinens klocka (inte databasens). Rensningen efter 90 dagar räknar från den när publiceringsdatum saknas.
      created_at    timestamptz NOT NULL DEFAULT now(),
      -- Tidpunkten för den version som gäller nu, om källan har uppdaterat artikeln (d02 uppdaterar r02).
      updated_at    timestamptz,
      -- Artikeln är en uppdatering av en tidigare version (uppföljning, specens avsnitt 5).
      is_followup   boolean NOT NULL DEFAULT false,
      -- Artikeln är en rättelse och ska alltid med i utskicket.
      is_correction boolean NOT NULL DEFAULT false,
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('swedish', coalesce(title, '') || ' ' || coalesce(summary, ''))
      ) STORED
    );

    -- Poster som berikningen hoppar över (dubbletter, ändrat innehåll, id-kollisioner, ogiltig URL).
    -- Hela råposten sparas, så att inget försvinner tyst och posten kan köras om. Unik per post, så att en omkörning inte dubblerar loggen.
    CREATE TABLE skipped_items (
      id               serial PRIMARY KEY,
      raw_id           text NOT NULL,
      url              text NOT NULL,
      reason           text NOT NULL,
      existing_raw_id  text,
      payload          jsonb NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (raw_id, url, reason)
    );

    CREATE TABLE entity_matches (
      entity_id   text NOT NULL,
      article_id  integer NOT NULL REFERENCES articles(id),
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Behörighet, profiler och utskick (används inte av koden än).
    CREATE TABLE workspaces (
      id    text PRIMARY KEY,
      name  text NOT NULL
    );

    CREATE TABLE users (
      id    text PRIMARY KEY,
      name  text NOT NULL,
      role  text NOT NULL CHECK (role IN ('owner', 'sysadmin', 'admin', 'editor', 'analyst', 'reader', 'service'))
    );

    -- Arbetsytan är en hård gräns. Nekat vinner alltid över tillåtet (specens avsnitt 2).
    CREATE TABLE memberships (
      user_id          text NOT NULL REFERENCES users(id),
      workspace_id     text NOT NULL REFERENCES workspaces(id),
      deny_categories  text[] NOT NULL DEFAULT '{}',
      deny_entities    text[] NOT NULL DEFAULT '{}',
      deny_sources     text[] NOT NULL DEFAULT '{}',
      max_urgency      text,
      PRIMARY KEY (user_id, workspace_id)
    );

    CREATE TABLE profiles (
      id          text PRIMARY KEY,
      owner_id    text NOT NULL REFERENCES users(id),
      spaces      text[] NOT NULL,
      visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace', 'organization')),
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Profiler versioneras: en ändrad fråga ger en ny version, och gamla träffar pekar på sin version.
    CREATE TABLE profile_versions (
      profile_id      text NOT NULL REFERENCES profiles(id),
      version         integer NOT NULL,
      query           text NOT NULL,
      semantic_query  text,
      filters         jsonb NOT NULL DEFAULT '{}',
      instruction     text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (profile_id, version)
    );

    -- Varför en artikel kom med: vilken profil, vilken term och vilken poäng (specens avsnitt 2).
    CREATE TABLE profile_matches (
      profile_id       text NOT NULL REFERENCES profiles(id),
      profile_version  integer NOT NULL,
      article_id       integer NOT NULL REFERENCES articles(id),
      term             text NOT NULL,
      score            real NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (profile_id, article_id, term),
      FOREIGN KEY (profile_id, profile_version) REFERENCES profile_versions(profile_id, version)
    );

    CREATE TABLE publications (
      id          text PRIMARY KEY,
      name        text NOT NULL,
      spaces      text[] NOT NULL,
      schedule    text NOT NULL,
      visibility  text NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('private', 'workspace', 'organization'))
    );

    -- Undantag per objekt från synligheten (specens avsnitt 2), för profiler och publikationer.
    CREATE TABLE visibility_exceptions (
      object_type  text NOT NULL CHECK (object_type IN ('profile', 'publication')),
      object_id    text NOT NULL,
      user_id      text NOT NULL REFERENCES users(id),
      allow        boolean NOT NULL,
      PRIMARY KEY (object_type, object_id, user_id)
    );

    CREATE TABLE sections (
      id              serial PRIMARY KEY,
      publication_id  text NOT NULL REFERENCES publications(id),
      profile_id      text NOT NULL REFERENCES profiles(id),
      title           text NOT NULL,
      position        integer NOT NULL DEFAULT 0
    );

    CREATE TABLE subscriptions (
      user_id         text NOT NULL REFERENCES users(id),
      publication_id  text NOT NULL REFERENCES publications(id),
      extra_profiles  text[] NOT NULL DEFAULT '{}',
      PRIMARY KEY (user_id, publication_id)
    );

    CREATE TABLE editions (
      id              serial PRIMARY KEY,
      publication_id  text NOT NULL REFERENCES publications(id),
      status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent')),
      content         jsonb NOT NULL DEFAULT '{}',
      created_at      timestamptz NOT NULL DEFAULT now(),
      sent_at         timestamptz,
      -- Mottagarna i samma utskick delar utgåva: utgåvan identifieras av publikation och sändningstid.
      UNIQUE (publication_id, sent_at)
    );

    -- Ett utskick per utgåva och mottagare, renderat inom mottagarens omfång.
    CREATE TABLE deliveries (
      id          serial PRIMARY KEY,
      edition_id  integer NOT NULL REFERENCES editions(id),
      user_id     text NOT NULL REFERENCES users(id),
      sent_at     timestamptz,
      UNIQUE (edition_id, user_id)
    );
    CREATE INDEX deliveries_user_idx ON deliveries (user_id);

    -- Vilka artiklar som ingick i en leverans. Det är utskicksloggen: en artikel som redan skickats till en användare
    -- skickas inte igen, och en story som redan funnits i ett utskick är en uppföljning (specens avsnitt 5).
    -- En egen tabell i stället för en jsonb-lista, för att kunna slå upp "har användaren fått artikel X" i SQL,
    -- med främmande nyckel mot articles och unikhet.
    CREATE TABLE delivery_items (
      delivery_id  integer NOT NULL REFERENCES deliveries(id),
      article_id   integer NOT NULL REFERENCES articles(id),
      PRIMARY KEY (delivery_id, article_id)
    );
    CREATE INDEX delivery_items_article_idx ON delivery_items (article_id);

    CREATE TABLE feedback (
      id           serial PRIMARY KEY,
      delivery_id  integer NOT NULL REFERENCES deliveries(id),
      article_id   integer NOT NULL REFERENCES articles(id),
      vote         text NOT NULL CHECK (vote IN ('up', 'down')),
      created_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (delivery_id, article_id)
    );

    -- Körningslogg per pipelinesteg (specens krav 7).
    CREATE TABLE pipeline_runs (
      id           serial PRIMARY KEY,
      step         text NOT NULL,
      status       text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
      started_at   timestamptz NOT NULL DEFAULT now(),
      finished_at  timestamptz,
      details      jsonb NOT NULL DEFAULT '{}'
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE pipeline_runs, feedback, delivery_items, deliveries, editions, subscriptions, sections, visibility_exceptions,
    publications, profile_matches, profile_versions, profiles, memberships, users, workspaces,
    skipped_items, entity_matches, articles, entities, content_scopes`);
}
