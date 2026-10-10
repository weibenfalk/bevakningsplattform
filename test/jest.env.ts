import { Logger } from '@nestjs/common';
import { testDatabaseUrl } from './test-database';

// Körs före varje testfil. Tvingar testerna till testdatabasen, även om DATABASE_URL pekar någon annanstans.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';

// Tysta Nests logg i testerna, så att trasiga svar som testas med flit inte fyller utskriften med varningar.
// Gäller bara testerna: produktionen loggar som vanligt. Sätt TEST_LOGS=1 för att se loggen när något felsöks.
// Testerna som vill veta att något loggas spionerar på Logger.prototype (se test/triage.spec.ts).
Logger.overrideLogger(process.env.TEST_LOGS ? ['log', 'warn', 'error'] : false); // helpers.ts följer samma inställning
