import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MyLogger } from './domain/GlobalServices/mylogger.service';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api/v1/');

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
