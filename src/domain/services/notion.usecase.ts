import { NotionOperation } from '../entities/notion-operation.entity';
import { INotionApiClient, ScrapedContent } from '../ports/INotionApiClient';
import { INotionRepository } from '../ports/INotionRepository';
import { IEventPublisher } from '../ports/IEventPublisher';
import { v4 as uuidv4 } from 'uuid';
import { NotionResponseDto } from '../../notion/dto/notion-response.dto';
import { SendNotionDto } from '../../notion/dto/send-notion.dto';

export class NotionUseCase {
  constructor(
    private readonly repository: INotionRepository,
    private readonly api: INotionApiClient,
    private readonly publisher: IEventPublisher,
  ) {}

  async execute(dto: SendNotionDto): Promise<NotionResponseDto> {
    const existing = await this.repository.findByMessageId(dto.messageId);

    if (existing?.status === 'SUCCESS') {
      return {
        messageId: dto.messageId,
        operation: existing.operation,
        status: 'SUCCESS',
        notionId: existing.notionId,
        timestamp: (existing.executedAt ?? existing.createdAt).toISOString(),
      };
    }

    const record = existing
      ? await this.repository.resetToPending(existing.id, dto.operation, dto.message, dto.metadata)
      : await this.repository.create(
          uuidv4(),
          dto.messageId,
          dto.operation,
          dto.message,
          dto.metadata,
        );

    this.publisher.publish('data.notion.operation.created', {
      messageId: dto.messageId,
      operation: dto.operation,
      timestamp: new Date().toISOString(),
    });

    try {
      const notionId = await this.dispatch(dto);
      await this.repository.markSuccess(record.id, notionId);

      this.publisher.publish('data.notion.operation.completed', {
        messageId: dto.messageId,
        operation: dto.operation,
        notionId,
        timestamp: new Date().toISOString(),
      });

      return {
        messageId: dto.messageId,
        operation: dto.operation,
        status: 'SUCCESS',
        notionId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.repository.markFailed(record.id, reason);

      this.publisher.publish('data.notion.operation.failed', {
        messageId: dto.messageId,
        operation: dto.operation,
        error: reason,
        timestamp: new Date().toISOString(),
      });

      return {
        messageId: dto.messageId,
        operation: dto.operation,
        status: 'FAILED',
        error: reason,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async dispatch(dto: SendNotionDto): Promise<string> {
    switch (dto.operation) {
      case 'create_page':
        return this.createPage(dto);
      case 'create_task':
        return this.createTask(dto);
      case 'invite_member':
        throw new Error(
          'invite_member is not supported via Notion integration tokens. ' +
            'Use Notion OAuth (user-scoped tokens) or invite via the Notion UI/Admin API instead.',
        );
      default:
        throw new Error(`Unknown Notion operation: ${dto.operation}`);
    }
  }

  private async createPage(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {};
    const parentPageId = meta['parent_page_id'] as string | undefined;
    if (!parentPageId) {
      throw new Error('metadata.parent_page_id is required for create_page');
    }

    const icon = meta['icon'] as string | undefined;
    const scrapedData = meta['scrapedData'] as Record<string, unknown> | undefined;
    const sourceUrl = meta['url'] as string | undefined;

    let title: string;
    let scrapedContent: ScrapedContent | undefined;

    if (scrapedData) {
      title = (scrapedData['title'] as string) || (meta['title'] as string) || dto.message;
      scrapedContent = {
        title,
        sections: (scrapedData['sections'] as string[]) ?? [],
        links: (scrapedData['links'] as Array<{ href: string; text: string }>) ?? [],
        text: (scrapedData['text'] as string) ?? '',
      };
    } else {
      title = (meta['title'] as string) ?? dto.message;
    }

    const result = await this.api.createPage({
      parentPageId,
      title,
      icon,
      sourceUrl,
      scrapedContent,
      rawMessage: scrapedContent ? undefined : dto.message,
    });

    return result.id;
  }

  private async createTask(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {};
    const databaseId = meta['database_id'] as string | undefined;
    if (!databaseId) {
      throw new Error('metadata.database_id is required for create_task');
    }

    const result = await this.api.createTask({
      databaseId,
      message: dto.message,
      titleProperty: meta['title_property'] as string | undefined,
      dueDate: meta['due_date'] as string | undefined,
      assigneeIds: meta['assignee_ids'] as string[] | undefined,
      priority: meta['priority'] as string | undefined,
    });

    return result.id;
  }
}
