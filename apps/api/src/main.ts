import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // Local convenience only. Deployed environments inject variables directly.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Payment webhooks are verified against the exact bytes received.
    rawBody: true,
  });
  configureApp(app);
  await app.listen(app.get(Env).PORT);
}

void bootstrap();
