import { db } from './db';

/** Kör alla migrationer i migrations/. Säkert att köra flera gånger. */
async function main() {
  const knex = db();
  const [, done] = await knex.migrate.latest({ directory: 'migrations', loadExtensions: ['.ts'] });
  console.log(done.length ? `Körde migrationer: ${done.join(', ')}` : 'Databasen är redan uppdaterad.');
  await knex.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
