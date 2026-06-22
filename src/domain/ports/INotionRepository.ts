import { NotionOperation } from '../entities/notion-operation.entity';

export interface INotionRepository {
  findByMessageId(messageId: string): Promise<NotionOperation | null>;
  create(
    id: string,
    messageId: string,
    operation: string,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<NotionOperation>;
  markSuccess(id: string, notionId: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  resetToPending(
    id: string,
    operation: string,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<NotionOperation>;
}
