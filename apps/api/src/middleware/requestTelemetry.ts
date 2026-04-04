import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

export function requestTelemetry(req: Request, res: Response, next: NextFunction) {
  const incomingCorrelation = req.header("x-correlation-id")?.trim();
  const correlationId = incomingCorrelation || randomUUID();

  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);

  const startedAt = Date.now();

  res.on("finish", () => {
    const logRecord = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "http_request",
      correlationId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      userId: req.user?.id ?? null
    };

    console.log(JSON.stringify(logRecord));
  });

  next();
}
