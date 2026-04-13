import { Module } from '@nestjs/common';
import { NotionService } from './notion.service';
import { NotionListener } from './notion.listener';

@Module({
  providers: [NotionService, NotionListener],
  exports: [NotionService],
})
export class NotionModule {}
