export type OperationStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface NotionOperationProps {
  id: string;
  messageId: string;
  operation: string;
  body: string;
  metadata?: Record<string, unknown>;
  status: OperationStatus;
  notionId?: string;
  errorReason?: string;
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class NotionOperation {
  readonly id: string;
  readonly messageId: string;
  readonly operation: string;
  readonly body: string;
  readonly metadata: Record<string, unknown> | undefined;
  readonly status: OperationStatus;
  readonly notionId: string | undefined;
  readonly errorReason: string | undefined;
  readonly executedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: NotionOperationProps) {
    this.id = props.id;
    this.messageId = props.messageId;
    this.operation = props.operation;
    this.body = props.body;
    this.metadata = props.metadata;
    this.status = props.status;
    this.notionId = props.notionId;
    this.errorReason = props.errorReason;
    this.executedAt = props.executedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isCompleted(): boolean {
    return this.status !== 'PENDING';
  }

  isFailed(): boolean {
    return this.status === 'FAILED';
  }

  canRetry(): boolean {
    return this.status === 'FAILED';
  }
}
