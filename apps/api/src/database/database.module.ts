import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Env } from '../config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle; same query API as Database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [Env],
      useFactory: (env: Env) =>
        new Pool({
          connectionString: env.DATABASE_URL,
          max: env.DATABASE_POOL_MAX,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          // Bound runaway queries so one slow request cannot hold a connection forever.
          statement_timeout: 15_000,
        }),
    },
    { provide: DB, inject: [PG_POOL], useFactory: createDatabase },
    PoolCloser,
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule {}
