import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { RABBITMQ_EXCHANGE } from './constants/queues';

type ConnectionModel = Awaited<ReturnType<typeof amqp.connect>>;

interface SubscriptionEntry {
  queue: string;
  routingKey: string;
  handler: (payload: Record<string, unknown>) => Promise<void>;
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: ConnectionModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly retryAttempts = 10;
  private readonly retryDelay = 3000;
  private connecting = false;
  private connectPromise: Promise<void> | null = null;
  private consumerTags: string[] = [];
  private subscriptions: SubscriptionEntry[] = [];
  private reconnecting = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private retryLoopBusy = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    try {
      await this.connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to connect during module init: ${msg}`);
    }
  }

  async onModuleDestroy() {
    this.logger.log('RabbitMQService shutting down...');
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    await this.disconnect();
  }

  async connect(retries: number = this.retryAttempts): Promise<void> {
    if (this.connecting && this.connectPromise) {
      await this.connectPromise;
      return;
    }

    if (this.isConnected()) return;

    try {
      this.connecting = true;
      this.connectPromise = this._doConnect(retries);
      await this.connectPromise;
    } finally {
      this.connecting = false;
      this.connectPromise = null;
    }
  }

  private async _doConnect(retries: number): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) {
      throw new Error('RABBITMQ_URL is not defined in environment variables');
    }

    try {
      this.logger.log(`Connecting to RabbitMQ at ${url}...`);
      const conn = await amqp.connect(url);

      conn.on('error', (err) => {
        this.logger.error(`RabbitMQ connection error: ${err.message}`);
      });

      conn.on('close', () => {
        if (this.reconnecting) return;
        this.reconnecting = true;
        this.logger.warn('RabbitMQ connection closed — reconnecting...');
        this.channel = null;
        this.connection = null;
        this.consumerTags = [];
        this.connect()
          .then(() => this._replaySubscriptions())
          .catch((e) => this.logger.error(`Reconnection failed: ${(e as Error).message}`))
          .finally(() => { this.reconnecting = false });
      });

      const ch = await conn.createChannel();

      ch.on('error', (err) => {
        this.logger.error(`RabbitMQ channel error: ${err.message}`);
      });

      await ch.assertExchange(RABBITMQ_EXCHANGE, 'topic', { durable: true });

      this.connection = conn;
      this.channel = ch;
      this.logger.log('Connected to RabbitMQ successfully');
    } catch (error) {
      if (retries > 0) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to connect (retries left: ${retries}): ${errorMessage}. Retrying in ${this.retryDelay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        await this._doConnect(retries - 1);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to connect after ${this.retryAttempts} attempts: ${errorMessage}`);
        throw error;
      }
    }
  }

  private async _setupConsumer(
    queue: string,
    routingKey: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
  ): Promise<string> {
    await this.channel!.assertQueue(queue, { durable: true });
    await this.channel!.bindQueue(queue, RABBITMQ_EXCHANGE, routingKey);
    this.channel!.prefetch(1);

    const result = await this.channel!.consume(
      queue,
      async (msg) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
          await handler(payload);
          this.channel!.ack(msg);
        } catch (error) {
          this.logger.error(`Error processing message from [${queue}]`, error);
          this.channel!.nack(msg, false, false);
        }
      },
      { noAck: false },
    );

    this.consumerTags.push(result.consumerTag);
    this.logger.log(`Subscribed → queue [${queue}] | routing key [${routingKey}]`);
    return result.consumerTag;
  }

  private async _replaySubscriptions(): Promise<void> {
    if (!this.channel) return;

    this.consumerTags = [];

    for (const sub of this.subscriptions) {
      try {
        await this._setupConsumer(sub.queue, sub.routingKey, sub.handler);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to resubscribe to ${sub.queue}: ${errorMessage}`);
      }
    }
  }

  private _startRetryLoop(): void {
    if (this.retryTimer) return;
    this.logger.warn('RabbitMQ not connected — starting background retry loop (every 5s)');
    this.retryTimer = setInterval(async () => {
      if (this.isConnected() && this.consumerTags.length === this.subscriptions.length) {
        clearInterval(this.retryTimer!);
        this.retryTimer = null;
        return;
      }
      if (this.retryLoopBusy || this.reconnecting || this.connecting) return;
      this.retryLoopBusy = true;
      try {
        if (!this.isConnected()) {
          await this.connect();
        }
        if (this.isConnected() && this.consumerTags.length < this.subscriptions.length) {
          await this._replaySubscriptions();
        }
      } catch {
        // will retry next interval
      } finally {
        this.retryLoopBusy = false;
      }
    }, 5000);
  }

  publish(routingKey: string, payload: Record<string, unknown>): void {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }

    const content = Buffer.from(JSON.stringify(payload));
    this.channel.publish(RABBITMQ_EXCHANGE, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
    });
    this.logger.debug(`Published → [${routingKey}]`);
  }

  async subscribe(
    queue: string,
    routingKey: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (!this.subscriptions.some((s) => s.queue === queue)) {
      this.subscriptions.push({ queue, routingKey, handler });
    }

    try {
      if (!this.isConnected()) {
        this.logger.log(`Auto-connecting to RabbitMQ for subscribe to ${queue}...`);
        await this.connect();
      }
      if (this.channel) {
        await this._setupConsumer(queue, routingKey, handler);
        return;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Initial subscribe to ${queue} failed: ${errorMessage} — retrying in background`);
    }

    this._startRetryLoop();
  }

  private async disconnect() {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // ignore close errors
    }
    this.channel = null;
    this.connection = null;
    this.consumerTags = [];
    this.logger.log('Disconnected from RabbitMQ');
  }

  async close(): Promise<void> {
    await this.disconnect();
  }

  isConnected(): boolean {
    return !!this.channel && !!this.connection;
  }
}
