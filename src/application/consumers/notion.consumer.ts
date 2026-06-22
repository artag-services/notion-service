import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ROUTING_KEYS, QUEUES } from '../../rabbitmq/constants/queues';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { NotionUseCase } from '../../domain/services/notion.usecase';
import { SendNotionDto } from '../../notion/dto/send-notion.dto';

@Injectable()
export class NotionConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotionConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly notion: NotionUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.rabbitmq.subscribe(QUEUES.NOTION_SEND, ROUTING_KEYS.NOTION_SEND, (payload) =>
        this.handleOperation(payload),
      );
      this.logger.log('NotionConsumer ready — listening on notion.send queue');
    } catch (err) {
      this.logger.error(`Failed to subscribe to notion.send: ${(err as Error).message}`);
    }
  }

  private async handleOperation(payload: Record<string, unknown>): Promise<void> {
    const dto = payload as unknown as SendNotionDto;

    this.logger.log(
      `Processing Notion operation [${dto.operation}] | messageId=${dto.messageId}`,
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

    const userId = this.extractUserId(dto);
    if (response.status === 'SUCCESS') {
      const notionPageUrl = `https://notion.so/${(response.notionId ?? '').replace(/-/g, '')}`;
      this.rabbitmq.publish(ROUTING_KEYS.SCRAPPING_NOTION_RESPONSE, {
        messageId: dto.messageId,
        operation: 'notion_page_created',
        status: 'SUCCESS',
        notionId: response.notionId,
        notionPageUrl,
        timestamp: new Date().toISOString(),
        userId,
      });
      this.logger.log(
        `scrapping-response SUCCESS published | messageId=${dto.messageId} notionId=${response.notionId}`,
      );
    } else {
      this.rabbitmq.publish(ROUTING_KEYS.SCRAPPING_NOTION_RESPONSE, {
        messageId: dto.messageId,
        operation: 'notion_page_created',
        status: 'FAILED',
        notionId: null,
        notionPageUrl: null,
        error: response.error ?? 'unknown',
        timestamp: new Date().toISOString(),
        userId,
      });
      this.logger.warn(
        `scrapping-response FAILED published | messageId=${dto.messageId} reason=${response.error}`,
      );
    }

    this.logger.log(`Notion operation ${dto.operation} done -> status=${response.status}`);
  }

  private extractUserId(dto: SendNotionDto): string | undefined {
    const meta = dto.metadata as Record<string, unknown> | undefined;
    return meta?.['userId'] as string | undefined;
  }
}
