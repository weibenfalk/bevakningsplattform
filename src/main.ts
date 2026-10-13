import 'reflect-metadata';
import { INestApplication, LogLevel, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService, DEFAULT_HOST, DEFAULT_PORT, parsePort } from './config/configuration';

export { DEFAULT_HOST, DEFAULT_PORT, parsePort };

export async function bootstrap(
  options: { port?: number; host?: string; logger?: false | LogLevel[] } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: options.logger ?? ['log', 'warn', 'error'] });
  const server = app.get<AppConfigService>(ConfigService).get('server', { infer: true });
  await app.listen(options.port ?? server.port, options.host ?? server.host);
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
