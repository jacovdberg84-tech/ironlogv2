import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { runWeeklyReportJob } from "../services/weeklyReportService.js";

export const adminAutomationRouter = Router();

const faultRuleBaseSchema = z.object({
  name: z.string().min(2),
  enabled: z.boolean().default(true),
  occurrenceThreshold: z.number().int().min(2).max(100),
  windowHours: z.number().int().min(1).max(168),
  channel: z.enum(["email", "teams_webhook", "whatsapp_webhook"]).default("email"),
  recipient: z.string().min(4)
});

const faultRuleSchema = faultRuleBaseSchema.superRefine((value, ctx) => {
  if (value.channel === "email") {
    const emailCheck = z.string().email().safeParse(value.recipient);
    if (!emailCheck.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "recipient must be a valid email" });
    }
  }

  if (value.channel !== "email") {
    const urlCheck = z.string().url().safeParse(value.recipient);
    if (!urlCheck.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "recipient must be a valid webhook URL" });
    }
  }
});

const faultRuleUpdateSchema = faultRuleBaseSchema.partial().superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide at least one field" });
  }
});

adminAutomationRouter.post("/weekly-gm/run", async (_req, res) => {
  const result = await runWeeklyReportJob("manual");
  return res.json(result);
});

adminAutomationRouter.get("/weekly-gm/runs", async (_req, res) => {
  const runs = await pool.query(
    `
      SELECT id, job_name AS "jobName", status, details, started_at AS "startedAt", finished_at AS "finishedAt"
      FROM automation_job_runs
      WHERE job_name = 'weekly_gm_report'
      ORDER BY started_at DESC
      LIMIT 20
    `
  );
  return res.json({ items: runs.rows });
});

adminAutomationRouter.get("/fault-rules", async (_req, res) => {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        enabled,
        occurrence_threshold AS "occurrenceThreshold",
        window_hours AS "windowHours",
        channel,
        recipient,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM fault_notification_rules
      ORDER BY id DESC
    `
  );

  return res.json({ items: result.rows });
});

adminAutomationRouter.post("/fault-rules", async (req, res) => {
  const parsed = faultRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const data = parsed.data;

  const result = await pool.query(
    `
      INSERT INTO fault_notification_rules(name, enabled, occurrence_threshold, window_hours, channel, recipient, updated_at)
      VALUES($1, $2, $3, $4, $5, $6, NOW())
      RETURNING
        id,
        name,
        enabled,
        occurrence_threshold AS "occurrenceThreshold",
        window_hours AS "windowHours",
        channel,
        recipient,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [data.name, data.enabled, data.occurrenceThreshold, data.windowHours, data.channel, data.recipient]
  );

  await pool.query(
    `
      INSERT INTO rbac_audit_logs(actor_user_id, action, target_type, target_id, metadata)
      VALUES($1, 'automation.fault_rule.create', 'fault_notification_rule', $2, $3::jsonb)
    `,
    [req.user?.id ?? null, String(result.rows[0].id), JSON.stringify(data)]
  );

  return res.status(201).json({ created: result.rows[0] });
});

adminAutomationRouter.patch("/fault-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid rule id" });
  }

  const parsed = faultRuleUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const existingResult = await pool.query("SELECT * FROM fault_notification_rules WHERE id = $1", [id]);
  const existing = existingResult.rows[0];
  if (!existing) {
    return res.status(404).json({ error: "Rule not found" });
  }

  const merged = {
    name: parsed.data.name ?? existing.name,
    enabled: parsed.data.enabled ?? existing.enabled,
    occurrenceThreshold: parsed.data.occurrenceThreshold ?? existing.occurrence_threshold,
    windowHours: parsed.data.windowHours ?? existing.window_hours,
    channel: parsed.data.channel ?? existing.channel,
    recipient: parsed.data.recipient ?? existing.recipient
  };

  const validateMerged = faultRuleSchema.safeParse(merged);
  if (!validateMerged.success) {
    return res.status(400).json({ error: "Invalid merged rule", details: validateMerged.error.flatten() });
  }

  const data = validateMerged.data;
  const updated = await pool.query(
    `
      UPDATE fault_notification_rules
      SET
        name = $2,
        enabled = $3,
        occurrence_threshold = $4,
        window_hours = $5,
        channel = $6,
        recipient = $7,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        name,
        enabled,
        occurrence_threshold AS "occurrenceThreshold",
        window_hours AS "windowHours",
        channel,
        recipient,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [id, data.name, data.enabled, data.occurrenceThreshold, data.windowHours, data.channel, data.recipient]
  );

  await pool.query(
    `
      INSERT INTO rbac_audit_logs(actor_user_id, action, target_type, target_id, metadata)
      VALUES($1, 'automation.fault_rule.update', 'fault_notification_rule', $2, $3::jsonb)
    `,
    [req.user?.id ?? null, String(id), JSON.stringify(data)]
  );

  return res.json({ updated: updated.rows[0] });
});

adminAutomationRouter.post("/fault-rules/:id/disable", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid rule id" });
  }

  const result = await pool.query(
    `
      UPDATE fault_notification_rules
      SET enabled = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "Rule not found" });
  }

  await pool.query(
    `
      INSERT INTO rbac_audit_logs(actor_user_id, action, target_type, target_id, metadata)
      VALUES($1, 'automation.fault_rule.disable', 'fault_notification_rule', $2, '{}'::jsonb)
    `,
    [req.user?.id ?? null, String(id)]
  );

  return res.json({ disabled: true });
});

adminAutomationRouter.delete("/fault-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid rule id" });
  }

  const result = await pool.query("DELETE FROM fault_notification_rules WHERE id = $1 RETURNING id", [id]);
  if (!result.rows[0]) {
    return res.status(404).json({ error: "Rule not found" });
  }

  await pool.query(
    `
      INSERT INTO rbac_audit_logs(actor_user_id, action, target_type, target_id, metadata)
      VALUES($1, 'automation.fault_rule.delete', 'fault_notification_rule', $2, '{}'::jsonb)
    `,
    [req.user?.id ?? null, String(id)]
  );

  return res.json({ deleted: true });
});
