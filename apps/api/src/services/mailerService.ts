import nodemailer from "nodemailer";
import { config } from "../config.js";

export async function sendMail(args: {
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; path: string }>;
}) {
  if (!config.smtpHost || !config.smtpUser || !config.smtpPassword) {
    console.log("SMTP not configured. Skipping email send.", {
      to: args.to,
      subject: args.subject
    });
    return { sent: false, reason: "smtp_not_configured" };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    connectionTimeout: config.notificationTimeoutMs,
    greetingTimeout: config.notificationTimeoutMs,
    socketTimeout: config.notificationTimeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword
    }
  });

  await transporter.sendMail({
    from: config.smtpFrom || config.smtpUser,
    to: args.to,
    subject: args.subject,
    text: args.text,
    attachments: args.attachments
  });

  return { sent: true };
}
