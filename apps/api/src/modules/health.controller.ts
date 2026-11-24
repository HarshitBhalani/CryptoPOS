import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Connection } from "@solana/web3.js";
import { Response } from "express";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";

@Controller("health")
export class HealthController {
  private readonly connection: Connection;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    const rpcUrl = this.config.get<string>(
      "SOLANA_RPC_URL",
      "https://api.devnet.solana.com"
    );
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  @Get("live")
  liveness() {
    return {
      status: "alive",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  @Get()
  async readiness(@Res() res: Response) {
    const start = Date.now();
    let dbStatus = "unknown";
    let dbLatencyMs = 0;
    let redisStatus = "unknown";
    let redisLatencyMs = 0;
    let rpcStatus = "unknown";
    let rpcLatencyMs = 0;
    let indexerStatus = "unknown";
    let isHealthy = true;

    // 1. Database check
    try {
      const dbStart = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = "ok";
    } catch {
      dbStatus = "failed";
      isHealthy = false;
    }

    // 2. Redis check
    try {
      const redisStart = Date.now();
      const pong = await this.redis.client.ping();
      redisLatencyMs = Date.now() - redisStart;
      redisStatus = pong.toLowerCase() === "pong" ? "ok" : "degraded";
    } catch {
      redisStatus = "failed";
      isHealthy = false;
    }

    // 3. Solana Devnet RPC check
    try {
      const rpcStart = Date.now();
      const slot = await this.connection.getSlot("confirmed");
      rpcLatencyMs = Date.now() - rpcStart;
      rpcStatus = `ok (slot ${slot})`;
    } catch {
      rpcStatus = "unreachable";
      // RPC transient unavailability does not mark core API dead, but flags degraded
    }

    // 4. Indexer checkpoint check
    try {
      const checkpoint = await this.prisma.indexerCheckpoint.findUnique({
        where: { key: "solana_devnet_payment_indexer" },
      });
      indexerStatus = checkpoint ? `active (slot ${checkpoint.lastSlot})` : "pending";
    } catch {
      indexerStatus = "unknown";
    }

    const totalLatencyMs = Date.now() - start;
    const mem = process.memoryUsage();

    const responsePayload = {
      success: isHealthy,
      message: isHealthy ? "CryptoPOS API ready" : "Service degraded",
      data: {
        status: isHealthy ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        network: "devnet",
        uptimeSeconds: Math.floor(process.uptime()),
        components: {
          database: { status: dbStatus, latencyMs: dbLatencyMs },
          redis: { status: redisStatus, latencyMs: redisLatencyMs },
          solanaRpc: { status: rpcStatus, latencyMs: rpcLatencyMs },
          indexer: { status: indexerStatus },
        },
        memory: {
          rssMb: Math.round(mem.rss / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        },
        totalLatencyMs,
      },
    };

    return res
      .status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(responsePayload);
  }
}
