import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Response } from "express";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("GlobalExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") {
        message = res;
      } else if (typeof res === "object" && res !== null) {
        const anyRes = res as any;
        if (Array.isArray(anyRes.message)) {
          message = anyRes.message.join(", ");
        } else if (anyRes.message) {
          message = anyRes.message;
        } else {
          message = exception.message;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Sanitize database errors so internal schemas/tables are not disclosed
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        message = "A record with this unique value already exists.";
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        message = "The requested record was not found.";
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = "Database operation constraint error.";
      }
      this.logger.warn(`Prisma error ${exception.code}: ${exception.message}`);
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
      // In production, never expose internal error stack traces
      if (process.env.NODE_ENV !== "production") {
        message = exception.message;
      }
    }

    response.status(status).json({
      success: false,
      message,
    });
  }
}
