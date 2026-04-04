import { sendMail } from "./mailerService.js";

type Channel = "email" | "teams_webhook" | "whatsapp_webhook";

export async function dispatchNotification(args: {
  channel: Channel;
  recipient: string;
  subject: string;
  message: string;
}) {
  if (args.channel === "email") {
    const result = await sendMail({
      to: args.recipient,
      subject: args.subject,
      text: args.message
    });
    return { delivered: result.sent, provider: "email", detail: result };
  }

  const payload = {
    source: "IRONLOG",
    channel: args.channel,
    subject: args.subject,
    message: args.message,
    createdAt: new Date().toISOString()
  };

  const response = await fetch(args.recipient, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
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
