import { Module } from '@nestjs/common';
import { NotionApiClient } from './clients/notion-api.client';
import { NotionUseCase } from '../domain/services/notion.usecase';
import { PrismaNotionRepository } from '../infrastructure/persistence/prisma-notion.repository';
import { NotionApiAdapter } from '../infrastructure/api/notion-api.adapter';
import { RabbitmqEventPublisher } from '../infrastructure/event-bus/rabbitmq-event-publisher';
import { NotionConsumer } from '../application/consumers/notion.consumer';

@Module({
  providers: [
    NotionApiClient,
    { provide: 'INotionRepository', useClass: PrismaNotionRepository },
    { provide: 'INotionApiClient', useClass: NotionApiAdapter },
    { provide: 'IEventPublisher', useClass: RabbitmqEventPublisher },
    {
      provide: NotionUseCase,
      useFactory: (repo, api, publisher) => new NotionUseCase(repo, api, publisher),
      inject: ['INotionRepository', 'INotionApiClient', 'IEventPublisher'],
    },
    NotionConsumer,
  ],
})
export class NotionModule {}
