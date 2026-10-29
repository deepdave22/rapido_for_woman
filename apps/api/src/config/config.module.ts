import { Global, Module } from '@nestjs/common';
import { Env, validateEnv } from './env';

/** Exposes the validated environment as an injectable `Env`. */
@Global()
@Module({
  providers: [{ provide: Env, useFactory: () => validateEnv(process.env) }],
  exports: [Env],
})
export class ConfigModule {}
