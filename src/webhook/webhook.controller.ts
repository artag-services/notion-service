import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Receives Notion webhook events (future use).
   * POST /webhook/notion
   */
  @Post('notion')
  @HttpCode(200)
  receiveEvent(@Body() body: Record<string, unknown>): { received: boolean } {
    this.webhookService.processEvent(body);
    return { received: true };
  }
}
