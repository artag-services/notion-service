import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3003;
  await app.listen(port);

  console.log(`Notion service running on port ${port}`);
}

bootstrap();
