export interface NotionResponseDto {
  messageId: string;
  operation: string;
  status: 'SUCCESS' | 'FAILED';
  notionId?: string;
  error?: string;
  timestamp: string;
}
