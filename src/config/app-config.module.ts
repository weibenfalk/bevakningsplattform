import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './configuration';
import { CLOCK, fixedClock } from './clock';
import { SOURCE_NAMES, SOURCE_WEIGHTS, loadSourceNames, loadSourceWeights } from './sources';
import { USER_DIRECTORY, loadUserDirectory } from './users';

/** Klockan och den inlästa konfigurationen (källor, användare), global så att alla moduler kan injicera den. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, inject: [ConfigService], useFactory: (config: AppConfigService) => fixedClock(config.get('pipelineNow', { infer: true })) },
    { provide: SOURCE_WEIGHTS, useValue: loadSourceWeights() },
    { provide: SOURCE_NAMES, useValue: loadSourceNames() },
    { provide: USER_DIRECTORY, useValue: loadUserDirectory() },
  ],
  exports: [CLOCK, SOURCE_WEIGHTS, SOURCE_NAMES, USER_DIRECTORY],
})
export class AppConfigModule {}
