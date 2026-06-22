import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { INotionRepository } from '../../domain/ports/INotionRepository';
import { NotionOperation } from '../../domain/entities/notion-operation.entity';

@Injectable()
export class PrismaNotionRepository implements INotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByMessageId(messageId: string): Promise<NotionOperation | null> {
    const record = await this.prisma.notionOperation.findUnique({
      where: { messageId },
    });
    return record ? this.toDomain(record) : null;
  }

  async create(
    id: string,
    messageId: string,
    operation: string,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<NotionOperation> {
    const record = await this.prisma.notionOperation.create({
      data: {
        id,
        messageId,
        operation,
        body,
        metadata: (metadata ?? {}) as object,
        status: 'PENDING',
      },
    });
    return this.toDomain(record);
  }

  async markSuccess(id: string, notionId: string): Promise<void> {
    await this.prisma.notionOperation.update({
      where: { id },
      data: { status: 'SUCCESS', notionId, executedAt: new Date(), errorReason: null },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.notionOperation.update({
      where: { id },
      data: { status: 'FAILED', errorReason: reason },
    });
  }

  async resetToPending(
    id: string,
    operation: string,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<NotionOperation> {
    const record = await this.prisma.notionOperation.update({
      where: { id },
      data: {
        operation,
        body,
        metadata: (metadata ?? {}) as object,
        status: 'PENDING',
        errorReason: null,
      },
    });
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    messageId: string;
    operation: string;
    body: string;
    metadata: unknown;
    status: string;
    notionId: string | null;
    errorReason: string | null;
    executedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): NotionOperation {
    return new NotionOperation({
      id: record.id,
      messageId: record.messageId,
      operation: record.operation,
      body: record.body,
      metadata: record.metadata ? (record.metadata as Record<string, unknown>) : undefined,
      status: record.status as 'PENDING' | 'SUCCESS' | 'FAILED',
      notionId: record.notionId ?? undefined,
      errorReason: record.errorReason ?? undefined,
      executedAt: record.executedAt ?? undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
