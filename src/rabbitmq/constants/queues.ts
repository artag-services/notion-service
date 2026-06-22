/**
 * Contratos RabbitMQ del microservicio Notion.
 */

export const RABBITMQ_EXCHANGE = 'channels';

export const ROUTING_KEYS = {
  NOTION_SEND: 'channels.notion.send',
  NOTION_RESPONSE: 'channels.notion.response',
  SCRAPPING_NOTION_RESPONSE: 'channels.scrapping.notion-response',
  DATA_NOTION_OPERATION_CREATED: 'data.notion.operation.created',
  DATA_NOTION_OPERATION_COMPLETED: 'data.notion.operation.completed',
  DATA_NOTION_OPERATION_FAILED: 'data.notion.operation.failed',
} as const;

export const QUEUES = {
  NOTION_SEND: 'notion.send',
  GATEWAY_RESPONSES: 'gateway.responses',
  SCRAPPING_NOTION_RESPONSE: 'scrapping.notion-response', // ✨ [NEW]
} as const;
