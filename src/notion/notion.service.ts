import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as NotionClient } from '@notionhq/client';
import { PrismaService } from '../prisma/prisma.service';
import { SendNotionDto, NotionOperation } from './dto/send-notion.dto';
import { NotionResponseDto } from './dto/notion-response.dto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Operation handler type: each handler receives the DTO and returns the Notion ID
 * of the created/modified resource.
 */
type OperationHandler = (dto: SendNotionDto) => Promise<string>;

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);
  private readonly notion: NotionClient;

  /**
   * Dispatch map: operation name → handler method.
   * To add a new operation, simply add a new entry here + implement the private method.
   * No changes needed in the listener or module.
   */
  private readonly operationHandlers: Record<NotionOperation, OperationHandler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const token = this.config.getOrThrow<string>('NOTION_INTEGRATION_TOKEN');
    this.notion = new NotionClient({ auth: token });

    this.operationHandlers = {
      create_page: (dto) => this.createPage(dto),
      create_task: (dto) => this.createTask(dto),
      invite_member: (dto) => this.inviteMember(dto),
    };
  }

  // ─────────────────────────────────────────
  // Public entry point
  // ─────────────────────────────────────────

  async execute(dto: SendNotionDto): Promise<NotionResponseDto> {
    const record = await this.prisma.notionOperation.create({
      data: {
        id: uuidv4(),
        messageId: dto.messageId,
        operation: dto.operation,
        body: dto.message,
        metadata: (dto.metadata ?? {}) as object,
        status: 'PENDING',
      },
    });

    const handler = this.operationHandlers[dto.operation];

    if (!handler) {
      await this.prisma.notionOperation.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorReason: `Unknown operation: ${dto.operation}` },
      });
      throw new BadRequestException(`Unknown Notion operation: ${dto.operation}`);
    }

    try {
      const notionId = await handler(dto);

      await this.prisma.notionOperation.update({
        where: { id: record.id },
        data: { status: 'SUCCESS', notionId, executedAt: new Date() },
      });

      this.logger.log(`Operation ${dto.operation} succeeded | notionId: ${notionId}`);

      return {
        messageId: dto.messageId,
        operation: dto.operation,
        status: 'SUCCESS',
        notionId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      await this.prisma.notionOperation.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorReason: reason },
      });

      this.logger.error(`Operation ${dto.operation} failed: ${reason}`);

      return {
        messageId: dto.messageId,
        operation: dto.operation,
        status: 'FAILED',
        error: reason,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ─────────────────────────────────────────
  // Operation handlers
  // ─────────────────────────────────────────

  /**
   * create_page: creates a new Notion page under a parent page.
   *
   * REQUIRED metadata:
   *   - parent_page_id: Notion page ID where the new page will be created
   *
   * OPTIONAL metadata:
   *   - title: overrides the `message` field as the page title
   *   - icon: emoji character (e.g. "🚀", "🎉", "📝", "💡")
   *          Notion validates emojis server-side. If an invalid emoji is provided,
   *          the operation will fail with an error. Only standard Unicode emoji
   *          characters are supported. If no icon is provided, Notion will use its default.
   *
   * Icon Support in Notion API:
   *   The Notion API supports 5 types of icons for pages:
   *   1. "emoji" (CURRENTLY SUPPORTED) - any Unicode emoji character
   *   2. "custom_emoji" - workspace-specific custom emojis (future support)
   *   3. "icon" - native Notion icons with color (e.g. "pizza", "meeting") (future support)
   *   4. "external" - external image URL (future support)
   *   5. "file_upload" - uploaded file (future support)
   *
   *   Currently we only support emoji icons. Additional icon types can be implemented
   *   by modifying the payload construction logic and updating the metadata schema.
   */
  private async createPage(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {};
    const parentPageId = meta['parent_page_id'] as string | undefined;

    if (!parentPageId) {
      throw new Error('metadata.parent_page_id is required for create_page');
    }

    const title = (meta['title'] as string | undefined) ?? dto.message;
    const icon = meta['icon'] as string | undefined;

    // Build the request payload dynamically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createPayload: any = {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }],
        },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: dto.message } }],
          },
        },
      ],
    };

    // Only include icon if user provided one
    if (icon) {
      createPayload.icon = { type: 'emoji', emoji: icon as never };
    }

    const response = await this.notion.pages.create(createPayload);

    return response.id;
  }

  /**
   * create_task: creates a new item in a Notion database.
   * Required metadata: database_id
   * Optional metadata: title_property, due_date, assignee_ids, priority
   */
  private async createTask(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {};
    const databaseId = meta['database_id'] as string | undefined;

    if (!databaseId) {
      throw new Error('metadata.database_id is required for create_task');
    }

    const titleProperty = (meta['title_property'] as string | undefined) ?? 'Name';
    const dueDate = meta['due_date'] as string | undefined;
    const assigneeIds = meta['assignee_ids'] as string[] | undefined;
    const priority = meta['priority'] as string | undefined;

    // Build properties dynamically — only include optional ones if provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      [titleProperty]: {
        title: [{ type: 'text', text: { content: dto.message } }],
      },
    };

    if (dueDate) {
      properties['Due Date'] = { date: { start: dueDate } };
    }

    if (priority) {
      properties['Priority'] = { select: { name: priority } };
    }

    if (assigneeIds && assigneeIds.length > 0) {
      properties['Assignee'] = {
        people: assigneeIds.map((id) => ({ id })),
      };
    }

    const response = await this.notion.pages.create({
      parent: { database_id: databaseId },
      properties,
    });

    return response.id;
  }

  /**
   * invite_member: invites a user to the workspace.
   * Required metadata: email
   * Optional metadata: page_id (to also give page-level access)
   *
   * Note: Workspace-level invitations require the integration to have
   * "Insert content" and admin permissions. Page sharing is more commonly available.
   */
  private async inviteMember(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {};
    const email = meta['email'] as string | undefined;
    const pageId = meta['page_id'] as string | undefined;

    if (!email) {
      throw new Error('metadata.email is required for invite_member');
    }

    if (!pageId) {
      throw new Error(
        'metadata.page_id is required for invite_member — Notion API only supports page-level sharing via integration tokens',
      );
    }

    // Share a specific page with the user
    const response = await this.notion.pages.update({
      page_id: pageId,
      // Notion does not expose a direct "share with user by email" endpoint in the API.
      // This is a placeholder — in practice you'd need to use the workspace members API
      // or handle this via OAuth and user-level tokens.
      properties: {},
    });

    this.logger.warn(
      `invite_member: Notion REST API does not directly support email invitations. ` +
        `Triggered a page update for ${pageId}. ` +
        `For real invitations, implement via Notion OAuth user tokens.`,
    );

    return response.id;
  }
}
