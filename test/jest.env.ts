import { testDatabaseUrl } from './test-database';

// Körs före varje testfil. Tvingar testerna till testdatabasen, även om DATABASE_URL pekar någon annanstans.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
