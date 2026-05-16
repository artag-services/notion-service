import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { ROUTING_KEYS, QUEUES } from '../rabbitmq/constants/queues'
import { RabbitMQService } from '../rabbitmq/rabbitmq.service'
import { SendNotionDto } from './dto/send-notion.dto'
import { NotionService } from './notion.service'

@Injectable()
export class NotionListener implements OnModuleInit {
  private readonly logger = new Logger(NotionListener.name)

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly notion: NotionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.subscribe(QUEUES.NOTION_SEND, ROUTING_KEYS.NOTION_SEND, (payload) =>
      this.handleOperation(payload),
    )
  }

  private async handleOperation(payload: Record<string, unknown>): Promise<void> {
    const dto = payload as unknown as SendNotionDto

    this.logger.log(
      `Processing Notion operation [${dto.operation}] | messageId=${dto.messageId}`,
    )

    const response = await this.notion.execute(dto)

    // Generic response back to the gateway / any caller.
    this.rabbitmq.publish(ROUTING_KEYS.NOTION_RESPONSE, {
      messageId: response.messageId,
      operation: response.operation,
      status: response.status === 'SUCCESS' ? 'SENT' : 'FAILED',
      notionId: response.notionId ?? null,
      error: response.error ?? null,
      timestamp: response.timestamp,
    })

    // Scrapping bridge: emit BOTH on success and failure so the scrapping
    // service never hangs waiting for a callback. Previously only the
    // success path was emitted → broken scraping → notion → whatsapp flow
    // if Notion errored.
    const userId = this.extractUserId(dto)
    if (response.status === 'SUCCESS') {
      const notionPageUrl = `https://notion.so/${(response.notionId ?? '').replace(/-/g, '')}`
      this.rabbitmq.publish(ROUTING_KEYS.SCRAPPING_NOTION_RESPONSE, {
        messageId: dto.messageId,
        operation: 'notion_page_created',
        status: 'SUCCESS',
        notionId: response.notionId,
        notionPageUrl,
        timestamp: new Date().toISOString(),
        userId,
      })
      this.logger.log(
        `✅ scrapping-response SUCCESS published | messageId=${dto.messageId} notionId=${response.notionId}`,
      )
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
      })
      this.logger.warn(
        `⚠️ scrapping-response FAILED published | messageId=${dto.messageId} reason=${response.error}`,
      )
    }

    this.logger.log(`Notion operation ${dto.operation} done → status=${response.status}`)
  }

  private extractUserId(dto: SendNotionDto): string | undefined {
    const meta = dto.metadata as Record<string, unknown> | undefined
    return meta?.['userId'] as string | undefined
  }
}
