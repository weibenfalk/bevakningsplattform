import 'reflect-metadata';
import { INestApplication, LogLevel, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export const DEFAULT_PORT = 3000;
/**
 * Lyssnar som standard bara på den egna datorn. Autentiseringen är en platshållare som litar på headern
 * `x-user-id` (se README), så servern ska inte vara nåbar utifrån. Sätt HOST för att ändra det, på eget ansvar.
 */
export const DEFAULT_HOST = '127.0.0.1';

/** Ett giltigt portnummer (1–65535) ur PORT, annars 3000. */
export function parsePort(value: string | undefined): number {
  const port = Number(value?.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

export async function bootstrap(
  options: { port?: number; host?: string; logger?: false | LogLevel[] } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: options.logger ?? ['log', 'warn', 'error'] });
  await app.listen(options.port ?? parsePort(process.env.PORT), options.host ?? process.env.HOST ?? DEFAULT_HOST);
  return app;
}

if (require.main === module) {
  bootstrap().then(async (app) => {
    new Logger('Main').log(`Lyssnar på ${await app.getUrl()}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
