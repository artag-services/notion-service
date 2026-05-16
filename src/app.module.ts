import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';
import { NotionModule } from './notion/notion.module';

// Per CLAUDE.md / architecture rule: webhooks land at the gateway and are
// bridged to this service via RabbitMQ. There is no direct webhook controller
// on this service. (Notion doesn't push events in the traditional sense anyway.)

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RabbitMQModule,
    NotionModule,
  ],
})
export class AppModule {}
