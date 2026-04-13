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

    // ✨ [NEW] Si exitoso, publicar respuesta a scrapping service
    if (response.status === 'SUCCESS') {
      const notionPageUrl = `https://notion.so/${(response.notionId || '').replace(/-/g, '')}`;
      
      this.rabbitmq.publish(ROUTING_KEYS.SCRAPPING_NOTION_RESPONSE, {
        messageId: dto.messageId,
        operation: 'notion_page_created',
        status: 'SUCCESS',
        notionId: response.notionId,
        notionPageUrl,
        timestamp: new Date().toISOString(),
        userId: (dto.metadata as any)?.userId, // Enviado por NotionAdapter
      });

      this.logger.log(
        `✅ Notion page created and response published to scrapping service: messageId=${dto.messageId}`,
      );
    }

    this.logger.log(
      `Notion operation ${dto.operation} done → status: ${response.status}`,
    );
  }
}
