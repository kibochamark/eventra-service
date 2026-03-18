import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api/v1');
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
