import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  processEvent(body: Record<string, unknown>): void {
    // Notion does not push webhook events in the traditional sense.
    // Future: implement Notion webhook verification if using Notion automations.
    this.logger.log(`Notion webhook event received: ${JSON.stringify(body)}`);
  }
}
