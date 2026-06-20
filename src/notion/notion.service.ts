import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'

import { PrismaService } from '../prisma/prisma.service'
import { NotionApiClient } from './clients/notion-api.client'
import { NotionResponseDto } from './dto/notion-response.dto'
import { NotionOperation, SendNotionDto } from './dto/send-notion.dto'

type OperationHandler = (dto: SendNotionDto) => Promise<string>

/**
 * Orchestrates Notion operations. HTTP + retry are delegated to
 * `NotionApiClient`. This service is responsible for:
 *   - Persisting an audit row per operation (`NotionOperation`)
 *   - Idempotency by `messageId` (return cached SUCCESS, retry FAILED)
 *   - Dispatching to per-operation handlers
 */
@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name)
  private readonly operationHandlers: Record<NotionOperation, OperationHandler>

  constructor(
    private readonly prisma: PrismaService,
    private readonly notion: NotionApiClient,
  ) {
    this.operationHandlers = {
      create_page: (dto) => this.createPage(dto),
      create_task: (dto) => this.createTask(dto),
      invite_member: (dto) => this.inviteMember(dto),
    }
  }

  // ─────────────── entry point ───────────────

  async execute(dto: SendNotionDto): Promise<NotionResponseDto> {
    this.logger.log(`execute: operation=${dto.operation} messageId=${dto.messageId} hasScrapedData=${!!(dto.metadata as any)?.scrapedData}`)

    // Idempotency: if we already have this messageId in SUCCESS, return it as-is.
    const existing = await this.prisma.notionOperation.findUnique({
      where: { messageId: dto.messageId },
    })

    if (existing?.status === 'SUCCESS') {
      this.logger.log(
        `Idempotent hit for messageId=${dto.messageId} → returning cached SUCCESS`,
      )
      return {
        messageId: dto.messageId,
        operation: existing.operation,
        status: 'SUCCESS',
        notionId: existing.notionId ?? undefined,
        timestamp: (existing.executedAt ?? existing.createdAt).toISOString(),
      }
    }

    // Reuse FAILED row if present, otherwise create fresh.
    const record = existing
      ? await this.prisma.notionOperation.update({
          where: { id: existing.id },
          data: {
            operation: dto.operation,
            body: dto.message,
            metadata: (dto.metadata ?? {}) as object,
            status: 'PENDING',
            errorReason: null,
          },
        })
      : await this.prisma.notionOperation.create({
          data: {
            id: uuidv4(),
            messageId: dto.messageId,
            operation: dto.operation,
            body: dto.message,
            metadata: (dto.metadata ?? {}) as object,
            status: 'PENDING',
          },
        })

    const handler = this.operationHandlers[dto.operation]
    if (!handler) {
      // class-validator should have caught this; keep as defense-in-depth.
      await this.markFailed(record.id, `Unknown operation: ${dto.operation}`)
      throw new BadRequestException(`Unknown Notion operation: ${dto.operation}`)
    }

    try {
      const notionId = await handler(dto)
      await this.prisma.notionOperation.update({
        where: { id: record.id },
        data: { status: 'SUCCESS', notionId, executedAt: new Date(), errorReason: null },
      })
      this.logger.log(`Operation ${dto.operation} succeeded | notionId=${notionId}`)
      return {
        messageId: dto.messageId,
        operation: dto.operation,
        status: 'SUCCESS',
        notionId,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.markFailed(record.id, reason)
      this.logger.error(`Operation ${dto.operation} failed: ${reason}`)
      return {
        messageId: dto.messageId,
        operation: dto.operation,
        status: 'FAILED',
        error: reason,
        timestamp: new Date().toISOString(),
      }
    }
  }

  // ─────────────── operation handlers ───────────────

  private async createPage(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {}
    const parentPageId = meta['parent_page_id'] as string | undefined
    if (!parentPageId) {
      throw new BadRequestException('metadata.parent_page_id is required for create_page')
    }

    const icon = meta['icon'] as string | undefined
    const scrapedData = meta['scrapedData'] as Record<string, unknown> | undefined

    let title: string
    let children: Record<string, unknown>[]

    if (scrapedData) {
      title = (scrapedData['title'] as string) || (meta['title'] as string) || dto.message
      children = this.buildScrapedBlocks(scrapedData, meta)
      const sections = (scrapedData['sections'] as any)?.length ?? 0
      const links = (scrapedData['links'] as any)?.length ?? 0
      const textLen = (scrapedData['text'] as string)?.length ?? 0
      this.logger.log(`createPage: scrapedData mode — title="${title}" sections=${sections} links=${links} textLen=${textLen} blocks=${children.length}`)
    } else {
      title = (meta['title'] as string | undefined) ?? dto.message
      const messageChunks = this.splitTextIntoChunks(dto.message)
      children = messageChunks.map((chunk) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
      }))
      this.logger.log(`createPage: legacy mode — title="${title}" chunks=${children.length}`)
    }

    const payload: Record<string, unknown> = {
      parent: { page_id: parentPageId },
      properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      children,
    }
    if (icon) payload.icon = { type: 'emoji', emoji: icon }

    const response = await this.notion.withRetry('createPage', () =>
      this.notion.sdk.pages.create(payload as Parameters<typeof this.notion.sdk.pages.create>[0]),
    )
    this.logger.log(`createPage: Notion API returned id=${response.id}`)
    return response.id
  }

  private buildScrapedBlocks(
    scrapedData: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const blocks: Record<string, unknown>[] = []

    const url = meta['url'] as string | undefined

    if (url && this.isValidUrl(url)) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: `📄 ` } },
            { type: 'text', text: { content: 'Scraped from: ' }, annotations: { bold: true } },
            { type: 'text', text: { content: url, link: { url } } },
          ],
        },
      })
    }

    const sections = (scrapedData['sections'] as string[]) ?? []
    for (const section of sections) {
      if (section.trim()) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: section } }] },
        })
      }
    }

    const rawLinks = (scrapedData['links'] as Array<{ href: string; text: string }>) ?? []
    for (const link of rawLinks) {
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
        })
      }
    }

    const text = (scrapedData['text'] as string) ?? ''
    if (text) {
      const chunks = this.splitTextIntoChunks(text)
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
        })
      }
    }

    return blocks
  }

  private async createTask(dto: SendNotionDto): Promise<string> {
    const meta = dto.metadata ?? {}
    const databaseId = meta['database_id'] as string | undefined
    if (!databaseId) {
      throw new BadRequestException('metadata.database_id is required for create_task')
    }

    const titleProperty = (meta['title_property'] as string | undefined) ?? 'Name'
    const dueDate = meta['due_date'] as string | undefined
    const assigneeIds = meta['assignee_ids'] as string[] | undefined
    const priority = meta['priority'] as string | undefined

    const properties: Record<string, unknown> = {
      [titleProperty]: { title: [{ type: 'text', text: { content: dto.message } }] },
    }
    if (dueDate) properties['Due Date'] = { date: { start: dueDate } }
    if (priority) properties['Priority'] = { select: { name: priority } }
    if (assigneeIds?.length) {
      properties['Assignee'] = { people: assigneeIds.map((id) => ({ id })) }
    }

    const response = await this.notion.withRetry('createTask', () =>
      this.notion.sdk.pages.create({
        parent: { database_id: databaseId },
        properties: properties as never,
      }),
    )
    return response.id
  }

  /**
   * invite_member: not supported via integration tokens. Notion's API only
   * allows page sharing through OAuth user-tokens or workspace admin actions.
   * Previously this method silently performed a no-op `pages.update` and
   * returned SUCCESS — misleading callers. Now it fails fast with a clear
   * error so callers know to use a different path.
   */
  private async inviteMember(_dto: SendNotionDto): Promise<string> {
    throw new BadRequestException(
      'invite_member is not supported via Notion integration tokens. ' +
        'Use Notion OAuth (user-scoped tokens) or invite via the Notion UI/Admin API instead.',
    )
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  // ─────────────── helpers ───────────────

  private async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.notionOperation.update({
      where: { id },
      data: { status: 'FAILED', errorReason: reason },
    })
  }

  /**
   * Split text into chunks ≤ 2000 chars (Notion API limit per text block).
   * Tries to break on newlines to preserve structure; falls back to hard
   * split if a single line exceeds the limit.
   */
  private splitTextIntoChunks(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) return [text]

    const chunks: string[] = []
    let currentChunk = ''
    const lines = text.split('\n')

    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
          currentChunk = ''
        }
        if (line.length > maxLength) {
          let remaining = line
          while (remaining.length > maxLength) {
            chunks.push(remaining.substring(0, maxLength))
            remaining = remaining.substring(maxLength)
          }
          currentChunk = remaining + '\n'
        } else {
          currentChunk = line + '\n'
        }
      } else {
        currentChunk += line + '\n'
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim())
    return chunks
  }
}
