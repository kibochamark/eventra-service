/**
 * Vercel serverless entry point.
 *
 * NestJS is bootstrapped once per container lifecycle (memoised).
 * Subsequent requests within the same warm instance skip the bootstrap entirely.
 * vercel.json routes every request here.
 */
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express, { type Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';

// Resolve the AppModule relative to this file at build time.
// @vercel/node (esbuild) resolves path aliases from tsconfig baseUrl.
import { AppModule } from '../src/app.module';

const expressServer: Express = express();
let bootstrapped: Promise<void> | null = null;

function bootstrap(): Promise<void> {
  if (bootstrapped) return bootstrapped;

  bootstrapped = (async () => {
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(expressServer),
      { logger: ['error', 'warn'] },
    );
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api/v1/');
    await app.init();
  })();

  return bootstrapped;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await bootstrap();
  expressServer(req, res);
}
