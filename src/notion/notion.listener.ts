import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { NotionService } from './notion.service';
import { ROUTING_KEYS, QUEUES } from '../rabbitmq/constants/queues';
import { SendNotionDto } from './dto/send-notion.dto';

@Injectable()
export class NotionListener implements OnModuleInit {
  private readonly logger = new Logger(NotionListener.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly notion: NotionService,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.subscribe(
      QUEUES.NOTION_SEND,
      ROUTING_KEYS.NOTION_SEND,
      (payload) => this.handleOperation(payload),
    );
  }

  private async handleOperation(payload: Record<string, unknown>): Promise<void> {
    const dto = payload as unknown as SendNotionDto;

    this.logger.log(
      `Processing Notion operation [${dto.operation}] | messageId: ${dto.messageId}`,
    );

    const response = await this.notion.execute(dto);

    this.rabbitmq.publish(ROUTING_KEYS.NOTION_RESPONSE, {
      messageId: response.messageId,
      operation: response.operation,
      status: response.status === 'SUCCESS' ? 'SENT' : 'FAILED',
      notionId: response.notionId ?? null,
      error: response.error ?? null,
      timestamp: response.timestamp,
    });

    this.logger.log(
      `Notion operation ${dto.operation} done → status: ${response.status}`,
    );
  }
}
