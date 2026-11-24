import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./modules/app.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { RequestLoggerMiddleware } from "./common/middleware/request-logger.middleware";
import { SecurityHeadersMiddleware } from "./common/middleware/security-headers.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());

  // Security headers & request logging
  const secHeaders = new SecurityHeadersMiddleware();
  const reqLogger = new RequestLoggerMiddleware();
  app.use((req: any, res: any, next: any) => secHeaders.use(req, res, next));
  app.use((req: any, res: any, next: any) => reqLogger.use(req, res, next));

  // Multi-origin CORS support
  const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy blocked access from origin: ${origin}`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`CryptoPOS API listening on port ${port} (environment: ${process.env.NODE_ENV ?? "development"})`);
}

bootstrap();
