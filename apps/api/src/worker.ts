import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./modules/app.module";
import { IndexerService } from "./modules/indexer/indexer.service";

async function bootstrap() {
  const logger = new Logger("CryptoPOS-Worker");
  logger.log("Starting independent Solana Devnet Payment Indexer worker...");

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "error", "warn"],
  });

  const indexer = app.get(IndexerService);
  await indexer.start();

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}. Shutting down worker gracefully...`);
    await indexer.stop();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  console.error("Worker bootstrap failure:", err);
  process.exit(1);
});
