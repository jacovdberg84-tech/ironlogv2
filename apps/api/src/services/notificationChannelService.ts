import { sendMail } from "./mailerService.js";
import { config } from "../config.js";

type Channel = "email" | "teams_webhook" | "whatsapp_webhook";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function dispatchNotification(args: {
  channel: Channel;
  recipient: string;
  subject: string;
  message: string;
}) {
  const timeoutMs = Math.max(1000, config.notificationTimeoutMs);

  if (args.channel === "email") {
    const result = await withTimeout(
      sendMail({
        to: args.recipient,
        subject: args.subject,
        text: args.message
      }),
      timeoutMs,
      `Notification delivery (${args.channel})`
    );

    return { delivered: result.sent, provider: "email", detail: result };
  }

  const payload = {
    source: "IRONLOG",
    channel: args.channel,
    subject: args.subject,
    message: args.message,
    createdAt: new Date().toISOString()
  };

  const controller = new AbortController();
  const abortHandle = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(args.recipient, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).finally(() => {
    clearTimeout(abortHandle);
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed: ${response.status}`);
  }

  return {
    delivered: true,
    provider: args.channel,
    detail: { status: response.status }
  };
}
