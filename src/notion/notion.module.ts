import { Module } from '@nestjs/common';
import { NotionApiClient } from './clients/notion-api.client';
import { NotionListener } from './notion.listener';
import { NotionService } from './notion.service';

@Module({
  providers: [NotionApiClient, NotionService, NotionListener],
  exports: [NotionService],
})
export class NotionModule {}
