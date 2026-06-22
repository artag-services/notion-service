import { Injectable, Logger } from '@nestjs/common';
import { NotionApiClient } from '../../notion/clients/notion-api.client';
import {
  CreatePageParams,
  CreateTaskParams,
  INotionApiClient,
  PageCreationResult,
  TaskCreationResult,
} from '../../domain/ports/INotionApiClient';

@Injectable()
export class NotionApiAdapter implements INotionApiClient {
  private readonly logger = new Logger(NotionApiAdapter.name);

  constructor(private readonly notionApi: NotionApiClient) {}

  async createPage(params: CreatePageParams): Promise<PageCreationResult> {
    const { parentPageId, title, icon, sourceUrl, scrapedContent, rawMessage } = params;

    const children: Record<string, unknown>[] = [];

    if (scrapedContent) {
      this.buildScrapedBlocks(scrapedContent, sourceUrl, children);
    } else if (rawMessage) {
      const chunks = this.splitTextIntoChunks(rawMessage);
      for (const chunk of chunks) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
        });
      }
    }

    const payload: Record<string, unknown> = {
      parent: { page_id: parentPageId },
      properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      children,
    };
    if (icon) {
      payload.icon = { type: 'emoji', emoji: icon };
    }

    this.logger.log(
      `createPage: title="${title}" children=${children.length}`,
    );

    const response = await this.notionApi.withRetry('createPage', () =>
      this.notionApi.sdk.pages.create(
        payload as Parameters<typeof this.notionApi.sdk.pages.create>[0],
      ),
    );

    return { id: response.id };
  }

  async createTask(params: CreateTaskParams): Promise<TaskCreationResult> {
    const { databaseId, message, titleProperty, dueDate, assigneeIds, priority } = params;

    const properties: Record<string, unknown> = {
      [titleProperty ?? 'Name']: {
        title: [{ type: 'text', text: { content: message } }],
      },
    };
    if (dueDate) {
      properties['Due Date'] = { date: { start: dueDate } };
    }
    if (priority) {
      properties['Priority'] = { select: { name: priority } };
    }
    if (assigneeIds?.length) {
      properties['Assignee'] = { people: assigneeIds.map((id) => ({ id })) };
    }

    const response = await this.notionApi.withRetry('createTask', () =>
      this.notionApi.sdk.pages.create({
        parent: { database_id: databaseId },
        properties: properties as never,
      }),
    );

    return { id: response.id };
  }

  private buildScrapedBlocks(
    scraped: { title: string; sections: string[]; links: Array<{ href: string; text: string }>; text: string },
    sourceUrl: string | undefined,
    blocks: Record<string, unknown>[],
  ): void {
    if (sourceUrl && this.isValidUrl(sourceUrl)) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: '\uD83D\uDCC4 ' } },
            { type: 'text', text: { content: 'Scraped from: ' }, annotations: { bold: true } },
            { type: 'text', text: { content: sourceUrl, link: { url: sourceUrl } } },
          ],
        },
      });
    }

    for (const section of scraped.sections) {
      if (section.trim()) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: section } }] },
        });
      }
    }

    for (const link of scraped.links) {
      if (link.href && link.text && this.isValidUrl(link.href)) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              {
                type: 'text',
                text: { content: link.text, link: { url: link.href } },
              },
            ],
          },
        });
      }
    }

    if (scraped.text) {
      const chunks = this.splitTextIntoChunks(scraped.text);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
        });
      }
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private splitTextIntoChunks(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        if (line.length > maxLength) {
          let remaining = line;
          while (remaining.length > maxLength) {
            chunks.push(remaining.substring(0, maxLength));
            remaining = remaining.substring(maxLength);
          }
          currentChunk = remaining + '\n';
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
  }
}
