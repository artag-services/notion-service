import { Injectable } from '@nestjs/common';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';

@Injectable()
export class RabbitmqEventPublisher implements IEventPublisher {
  constructor(private readonly rabbitmq: RabbitMQService) {}

  publish(routingKey: string, payload: Record<string, unknown>): void {
    this.rabbitmq.publish(routingKey, payload);
  }
}
