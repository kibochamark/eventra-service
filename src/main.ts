import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

const expressApp = express();

export const createNestServer = async (expressInstance: express.Express) => {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressInstance),
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api/v1/');
  await app.init();
  return app;
};

// Local development only — Vercel handles the listener in production
if (process.env.NODE_ENV !== 'production') {
  createNestServer(expressApp).then(() => {
    expressApp.listen(process.env.PORT ?? 4000, () => {
      console.log(`Server running on port ${process.env.PORT ?? 4000}`);
    });
  });
}
