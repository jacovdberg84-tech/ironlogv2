import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  jwtRefreshExpiresInDays: Number(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? 14),
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5),
  loginLockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15),
  loginRateLimitWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60000),
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 20),
  weeklyReportCron: process.env.WEEKLY_REPORT_CRON ?? "0 6 * * 1",
  weeklyReportRecipient: process.env.WEEKLY_REPORT_RECIPIENT ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "",
  syntheticLoadCron: process.env.SYNTHETIC_LOAD_CRON ?? "",
  syntheticLoadDefaultSiteCode: process.env.SYNTHETIC_LOAD_DEFAULT_SITE_CODE ?? "SITE-A",
  syntheticLoadDefaultDays: Number(process.env.SYNTHETIC_LOAD_DEFAULT_DAYS ?? 7),
  syntheticLoadDefaultMachines: (process.env.SYNTHETIC_LOAD_DEFAULT_MACHINES ?? "EQ-1001,EQ-1002,EQ-1007,EQ-1010")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
  syntheticLoadDefaultEventsPerDayPerMachine: Number(process.env.SYNTHETIC_LOAD_DEFAULT_EVENTS_PER_DAY_PER_MACHINE ?? 3),
  syntheticLoadDefaultIncludeCriticalSpike: process.env.SYNTHETIC_LOAD_DEFAULT_INCLUDE_CRITICAL_SPIKE !== "false",
  workOrderSlaCron: process.env.WORK_ORDER_SLA_CRON ?? "*/20 * * * *",
  workOrderEscalationRetryCron: process.env.WORK_ORDER_ESCALATION_RETRY_CRON ?? "*/5 * * * *",
  executiveShiftReportCron: process.env.EXECUTIVE_SHIFT_REPORT_CRON ?? "0 5 * * *",
  executiveShiftReportDefaultSiteCode: process.env.EXECUTIVE_SHIFT_REPORT_DEFAULT_SITE_CODE ?? "SITE-A",
  executiveShiftReportRecipients: (process.env.EXECUTIVE_SHIFT_REPORT_RECIPIENTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
};

export function validateSecurityConfig() {
  const weakDefaultSecret = !config.jwtSecret || config.jwtSecret === "replace_with_strong_secret";
  const tooShortSecret = config.jwtSecret.length < 32;

  if (config.nodeEnv === "production") {
    if (weakDefaultSecret || tooShortSecret) {
      throw new Error("JWT_SECRET must be set and at least 32 characters in production");
    }
  }
}
