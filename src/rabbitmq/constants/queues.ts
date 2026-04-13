/**
 * Contratos RabbitMQ del microservicio Notion.
 */

export const RABBITMQ_EXCHANGE = 'channels';

export const ROUTING_KEYS = {
  NOTION_SEND: 'channels.notion.send',
  NOTION_RESPONSE: 'channels.notion.response',
} as const;

export const QUEUES = {
  NOTION_SEND: 'notion.send',
  GATEWAY_RESPONSES: 'gateway.responses',
} as const;
