import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../permissions.js";
import { pool } from "../db/pool.js";
import { evaluateFaultRulesForEvent } from "../services/faultEngineService.js";
import {
  addInvestigationAction,
  closeInvestigationCase,
  createInvestigationCase,
  getInvestigationCase,
  listInvestigationCases,
  updateInvestigationAction
} from "../services/ironmindCaseService.js";
import { detectRecurringFaults, draftDocument } from "../services/aiService.js";
import {
  getIronmindIntelOverview,
  getIronmindIntelTimeline,
  getIronmindRecommendations,
  runIronmindWhatIfScenario
} from "../services/ironmindIntelService.js";
import { realtimeHub } from "../services/realtimeHub.js";

export const ironmindRouter = Router();

const docSchema = z.object({
  prompt: z.string().min(10)
});

const recurringSchema = z.object({
  history: z.array(
    z.object({
      machineId: z.string(),
      fault: z.string()
    })
  )
});

const faultEventSchema = z.object({
  machineCode: z.string().min(2),
  faultCode: z.string().min(2),
  severity: z.enum(["low", "warning", "high", "critical"]).default("warning"),
  notes: z.string().optional(),
  occurredAt: z.string().optional()
});

const intelOverviewQuerySchema = z.object({
  hours: z.coerce.number().min(1).max(24 * 30).optional().default(24 * 7)
});

const intelTimelineQuerySchema = z.object({
  machineCode: z.string().min(2).optional(),
  limit: z.coerce.number().min(10).max(200).optional().default(60)
});

const whatIfSchema = z.object({
  machineCode: z.string().min(2),
  faultCode: z.string().min(2),
  incomingEvents: z.number().int().min(0).max(100),
  windowHours: z.number().int().min(1).max(24 * 30).default(24)
});

const createCaseSchema = z.object({
  machineCode: z.string().min(2),
  faultCode: z.string().min(2),
  severity: z.enum(["low", "warning", "high", "critical"]).default("warning"),
  title: z.string().min(5),
  description: z.string().optional(),
  ownerName: z.string().optional()
});

const listCasesQuerySchema = z.object({
  limit: z.coerce.number().min(10).max(200).optional().default(50),
  status: z.enum(["open", "investigating", "monitoring", "closed"]).optional()
});

const paramsCaseIdSchema = z.object({
  caseId: z.coerce.number().int().positive()
});

const addActionSchema = z.object({
  actionTitle: z.string().min(4),
  ownerName: z.string().optional(),
  dueAt: z.string().optional(),
  notes: z.string().optional()
});

const updateActionParamsSchema = z.object({
  caseId: z.coerce.number().int().positive(),
  actionId: z.coerce.number().int().positive()
});

const updateActionSchema = z.object({
  status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
  ownerName: z.string().optional(),
  dueAt: z.string().optional(),
  notes: z.string().optional()
});

const closeCaseSchema = z.object({
  closureSummary: z.string().optional()
});

const predictiveQuerySchema = z.object({
  horizonHours: z.coerce.number().min(12).max(24 * 7).optional().default(72),
  windowHours: z.coerce.number().min(24).max(24 * 30).optional().default(24 * 14)
});

ironmindRouter.post("/document", requirePermission(PERMISSIONS.ironmindWrite), async (req, res) => {
  const parsed = docSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const draft = await draftDocument(parsed.data.prompt);
  return res.json(draft);
});

ironmindRouter.post("/faults/recurring", requirePermission(PERMISSIONS.ironmindWrite), (req, res) => {
  const parsed = recurringSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  return res.json({ alerts: detectRecurringFaults(parsed.data.history) });
});

ironmindRouter.post("/faults/events", requirePermission(PERMISSIONS.ironmindWrite), async (req, res) => {
  const parsed = faultEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const occurredAt = data.occurredAt ?? new Date().toISOString();

  const inserted = await pool.query(
    `
      INSERT INTO fault_events(machine_code, fault_code, severity, notes, occurred_at)
      VALUES($1, $2, $3, $4, $5::timestamptz)
      RETURNING id
    `,
    [data.machineCode, data.faultCode, data.severity, data.notes ?? null, occurredAt]
  );

  const eventId = inserted.rows[0]?.id as number;
  const alerts = await evaluateFaultRulesForEvent({
    eventId,
    machineCode: data.machineCode,
    faultCode: data.faultCode,
    occurredAt
  });

  realtimeHub.publishFaultEventCreated({
    eventId,
    machineCode: data.machineCode,
    faultCode: data.faultCode,
    severity: data.severity,
    occurredAt,
    alertsTriggered: alerts.length,
    correlationId: req.correlationId
  });

  return res.status(201).json({
    eventId,
    alertsTriggered: alerts.length,
    alerts
  });
});

ironmindRouter.get("/faults/notifications", requirePermission(PERMISSIONS.ironmindRead), async (_req, res) => {
  const result = await pool.query(
    `
      SELECT
        fn.id,
        fn.machine_code AS "machineCode",
        fn.fault_code AS "faultCode",
        fn.occurrence_count AS "occurrenceCount",
        fn.status,
        fn.payload,
        fn.created_at AS "createdAt",
        r.name AS "ruleName"
      FROM fault_notifications fn
      LEFT JOIN fault_notification_rules r ON r.id = fn.rule_id
      ORDER BY fn.created_at DESC
      LIMIT 50
    `
  );

  return res.json({ items: result.rows });
});

ironmindRouter.get("/intel/overview", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = intelOverviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const summary = await getIronmindIntelOverview(parsed.data.hours);
  return res.json(summary);
});

ironmindRouter.get("/intel/timeline", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = intelTimelineQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const timeline = await getIronmindIntelTimeline(parsed.data.machineCode ?? null, parsed.data.limit);
  return res.json(timeline);
});

ironmindRouter.get("/intel/recommendations", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = intelOverviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const recommendations = await getIronmindRecommendations(parsed.data.hours);
  return res.json(recommendations);
});

ironmindRouter.post("/intel/what-if", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = whatIfSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const result = await runIronmindWhatIfScenario(parsed.data);
  return res.json(result);
});

ironmindRouter.get("/intel/predictive", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = predictiveQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const horizonHours = parsed.data.horizonHours;
  const windowHours = parsed.data.windowHours;

  const result = await pool.query<{
    machineCode: string;
    occurrences: number;
    severityScore: number;
    recentOccurrences: number;
  }>(
    `
      WITH historical AS (
        SELECT
          machine_code AS "machineCode",
          COUNT(*)::int AS occurrences,
          SUM(
            CASE severity
              WHEN 'low' THEN 1
              WHEN 'warning' THEN 2
              WHEN 'high' THEN 3
              WHEN 'critical' THEN 5
              ELSE 1
            END
          )::int AS "severityScore"
        FROM fault_events
        WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 hour')
        GROUP BY machine_code
      ),
      recent AS (
        SELECT
          machine_code AS "machineCode",
          COUNT(*)::int AS "recentOccurrences"
        FROM fault_events
        WHERE occurred_at >= NOW() - ((GREATEST($2::int, 12))::int * INTERVAL '1 hour')
        GROUP BY machine_code
      )
      SELECT
        h."machineCode",
        h.occurrences,
        h."severityScore",
        COALESCE(r."recentOccurrences", 0)::int AS "recentOccurrences"
      FROM historical h
      LEFT JOIN recent r ON r."machineCode" = h."machineCode"
      ORDER BY h."severityScore" DESC
      LIMIT 20
    `,
    [windowHours, Math.floor(horizonHours / 2)]
  );

  const machines = result.rows.map((row) => {
    const baseRate = row.occurrences / Math.max(windowHours, 1);
    const acceleration = row.recentOccurrences / Math.max(horizonHours / 2, 1);
    const rawScore = baseRate * 45 + acceleration * 35 + row.severityScore * 0.9;
    const probability = Math.max(1, Math.min(99, Number(rawScore.toFixed(2))));

    let band: "low" | "medium" | "high" | "critical" = "low";
    if (probability >= 70) {
      band = "critical";
    } else if (probability >= 50) {
      band = "high";
    } else if (probability >= 30) {
      band = "medium";
    }

    return {
      machineCode: row.machineCode,
      probabilityNextHorizonPct: probability,
      riskBand: band,
      observations: {
        occurrences: row.occurrences,
        severityScore: row.severityScore,
        recentOccurrences: row.recentOccurrences,
        horizonHours,
        sourceWindowHours: windowHours
      }
    };
  });

  return res.json({
    generatedAt: new Date().toISOString(),
    horizonHours,
    windowHours,
    machines
  });
});

ironmindRouter.get("/cases", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = listCasesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const items = await listInvestigationCases(parsed.data.limit, parsed.data.status);
  return res.json({ items });
});

ironmindRouter.post("/cases", requirePermission(PERMISSIONS.ironmindWrite), async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const created = await createInvestigationCase({
    ...parsed.data,
    openedBy: req.user!.id
  });

  if (!created) {
    return res.status(500).json({ error: "Failed to create case" });
  }

  realtimeHub.publishInvestigationCaseUpdated({
    caseId: Number(created.id),
    status: String(created.status ?? "open"),
    caseCode: String(created.caseCode),
    machineCode: String(created.machineCode),
    faultCode: String(created.faultCode),
    title: String(created.title),
    ownerName: created.ownerName ? String(created.ownerName) : null,
    occurredAt: new Date().toISOString()
  });

  return res.status(201).json(created);
});

ironmindRouter.get("/cases/:caseId", requirePermission(PERMISSIONS.ironmindRead), async (req, res) => {
  const parsed = paramsCaseIdSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid case id", details: parsed.error.flatten() });
  }

  const item = await getInvestigationCase(parsed.data.caseId);
  if (!item) {
    return res.status(404).json({ error: "Case not found" });
  }

  return res.json(item);
});

ironmindRouter.post("/cases/:caseId/actions", requirePermission(PERMISSIONS.ironmindWrite), async (req, res) => {
  const paramParsed = paramsCaseIdSchema.safeParse(req.params);
  const bodyParsed = addActionSchema.safeParse(req.body);
  if (!paramParsed.success || !bodyParsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: paramParsed.success ? null : paramParsed.error.flatten(),
        body: bodyParsed.success ? null : bodyParsed.error.flatten()
      }
    });
  }

  const item = await addInvestigationAction({
    caseId: paramParsed.data.caseId,
    actionTitle: bodyParsed.data.actionTitle,
    ownerName: bodyParsed.data.ownerName,
    dueAt: bodyParsed.data.dueAt,
    notes: bodyParsed.data.notes,
    createdBy: req.user!.id
  });

  return res.json(item);
});

ironmindRouter.patch("/cases/:caseId/actions/:actionId", requirePermission(PERMISSIONS.ironmindWrite), async (req, res) => {
  const paramParsed = updateActionParamsSchema.safeParse(req.params);
  const bodyParsed = updateActionSchema.safeParse(req.body);
  if (!paramParsed.success || !bodyParsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: paramParsed.success ? null : paramParsed.error.flatten(),
        body: bodyParsed.success ? null : bodyParsed.error.flatten()
      }
    });
  }

  const item = await updateInvestigationAction({
    caseId: paramParsed.data.caseId,
    actionId: paramParsed.data.actionId,
    ...bodyParsed.data
  });

  return res.json(item);
});

ironmindRouter.post("/cases/:caseId/close", requirePermission(PERMISSIONS.ironmindWrite), async (req, res) => {
  const paramParsed = paramsCaseIdSchema.safeParse(req.params);
  const bodyParsed = closeCaseSchema.safeParse(req.body ?? {});
  if (!paramParsed.success || !bodyParsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: paramParsed.success ? null : paramParsed.error.flatten(),
        body: bodyParsed.success ? null : bodyParsed.error.flatten()
      }
    });
  }

  const item = await closeInvestigationCase(paramParsed.data.caseId, bodyParsed.data.closureSummary);
  if (!item) {
    return res.status(404).json({ error: "Case not found" });
  }

  realtimeHub.publishInvestigationCaseUpdated({
    caseId: Number(item.id),
    status: String(item.status ?? "closed"),
    caseCode: String(item.caseCode),
    machineCode: String(item.machineCode),
    faultCode: String(item.faultCode),
    title: String(item.title),
    ownerName: item.ownerName ? String(item.ownerName) : null,
    occurredAt: new Date().toISOString()
  });

  return res.json(item);
});
