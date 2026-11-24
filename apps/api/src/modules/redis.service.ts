import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });
    this.client.on("error", (err) => {
      this.logger.warn(`Redis client error: ${err?.message ?? err}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (err: any) {
      this.logger.warn(`Initial Redis connection failed: ${err?.message ?? err}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
