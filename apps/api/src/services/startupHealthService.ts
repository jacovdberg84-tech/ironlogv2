import { createClient } from "redis";
import { pool } from "../db/pool.js";
import { config } from "../config.js";

type DependencyStatus = {
  status: "ok" | "error";
  message: string;
  latencyMs: number;
};

function now() {
  return Number(process.hrtime.bigint() / BigInt(1_000_000));
}

async function checkDatabase(): Promise<DependencyStatus> {
  const start = now();
  try {
    await pool.query("SELECT 1 AS ok");
    return {
      status: "ok",
      message: "PostgreSQL reachable",
      latencyMs: now() - start
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Database check failed",
      latencyMs: now() - start
    };
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  const start = now();
  if (!config.redisUrl) {
    return {
      status: "error",
      message: "REDIS_URL not configured",
      latencyMs: now() - start
    };
  }

  const client = createClient({ url: config.redisUrl });

  try {
    await client.connect();
    await client.ping();
    return {
      status: "ok",
      message: "Redis reachable",
      latencyMs: now() - start
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Redis check failed",
      latencyMs: now() - start
    };
  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
}

export async function getStartupHealth() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const overall = database.status === "ok" && redis.status === "ok" ? "ok" : "degraded";

  return {
    status: overall,
    service: "ironlog-api",
    dependencies: {
      database,
      redis
    },
    checkedAt: new Date().toISOString()
  };
}
