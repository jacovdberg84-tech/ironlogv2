import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { dispatchNotification } from "./notificationChannelService.js";
import { sendMail } from "./mailerService.js";
import { getRoleScorecard, getShiftCommandBoard, getWorkOrderAttribution } from "./workOrderService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const evidenceDir = path.resolve(__dirname, "../../reports/work-order-evidence");
const executiveReportDir = path.resolve(__dirname, "../../reports/executive");
const allowedAttachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

function normalizeSiteCode(siteCode?: string | null) {
  const safe = (siteCode ?? "SITE-A").trim().toUpperCase();
  return safe.length > 0 ? safe : "SITE-A";
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function trimText(value: string | undefined | null) {
  return (value ?? "").trim();
}

function base64ToBuffer(contentBase64: string) {
  const normalized = contentBase64.includes(",") ? contentBase64.split(",").pop() ?? "" : contentBase64;
  return Buffer.from(normalized, "base64");
}

function isPreviewableImageMime(mimeType: string) {
  return mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp";
}

function nextRetryTimestamp(attempts: number) {
  const baseMinutes = 5;
  const delayMinutes = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)) * baseMinutes);
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

export async function listSlaRules(siteCode: string) {
  const safeSiteCode = normalizeSiteCode(siteCode);
  const result = await pool.query(
    `
      SELECT
        id,
        site_code AS "siteCode",
        name,
        enabled,
        applies_priority AS "appliesPriority",
        applies_department AS "appliesDepartment",
        breach_after_hours AS "breachAfterHours",
        escalation_channel AS "escalationChannel",
        escalation_recipient AS "escalationRecipient",
        auto_request_approval AS "autoRequestApproval",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM work_order_sla_rules
      WHERE site_code = $1
      ORDER BY updated_at DESC
    `,
    [safeSiteCode]
  );

  return { items: result.rows };
}

export async function createSlaRule(input: {
  siteCode: string;
  name: string;
  enabled: boolean;
  appliesPriority?: "low" | "medium" | "high" | "critical";
  appliesDepartment?: string;
  breachAfterHours: number;
  escalationChannel: "email" | "teams_webhook" | "whatsapp_webhook";
  escalationRecipient: string;
  autoRequestApproval: boolean;
}) {
  const safeSiteCode = normalizeSiteCode(input.siteCode);

  const result = await pool.query(
    `
      INSERT INTO work_order_sla_rules(
        site_code,
        name,
        enabled,
        applies_priority,
        applies_department,
        breach_after_hours,
        escalation_channel,
        escalation_recipient,
        auto_request_approval,
        updated_at
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (site_code, name)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        applies_priority = EXCLUDED.applies_priority,
        applies_department = EXCLUDED.applies_department,
        breach_after_hours = EXCLUDED.breach_after_hours,
        escalation_channel = EXCLUDED.escalation_channel,
        escalation_recipient = EXCLUDED.escalation_recipient,
        auto_request_approval = EXCLUDED.auto_request_approval,
        updated_at = NOW()
      RETURNING
        id,
        site_code AS "siteCode",
        name,
        enabled,
        applies_priority AS "appliesPriority",
        applies_department AS "appliesDepartment",
        breach_after_hours AS "breachAfterHours",
        escalation_channel AS "escalationChannel",
        escalation_recipient AS "escalationRecipient",
        auto_request_approval AS "autoRequestApproval",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      safeSiteCode,
      trimText(input.name),
      input.enabled,
      input.appliesPriority ?? null,
      trimText(input.appliesDepartment) || null,
      input.breachAfterHours,
      input.escalationChannel,
      trimText(input.escalationRecipient),
      input.autoRequestApproval
    ]
  );

  return result.rows[0];
}

export async function updateSlaRule(ruleId: number, input: Partial<{
  name: string;
  enabled: boolean;
  appliesPriority: "low" | "medium" | "high" | "critical" | null;
  appliesDepartment: string | null;
  breachAfterHours: number;
  escalationChannel: "email" | "teams_webhook" | "whatsapp_webhook";
  escalationRecipient: string;
  autoRequestApproval: boolean;
}>) {
  const current = await pool.query("SELECT * FROM work_order_sla_rules WHERE id = $1", [ruleId]);
  const row = current.rows[0];
  if (!row) {
    return null;
  }

  const merged = {
    name: input.name ?? row.name,
    enabled: input.enabled ?? row.enabled,
    appliesPriority: input.appliesPriority === undefined ? row.applies_priority : input.appliesPriority,
    appliesDepartment: input.appliesDepartment === undefined ? row.applies_department : input.appliesDepartment,
    breachAfterHours: input.breachAfterHours ?? Number(row.breach_after_hours),
    escalationChannel: input.escalationChannel ?? row.escalation_channel,
    escalationRecipient: input.escalationRecipient ?? row.escalation_recipient,
    autoRequestApproval: input.autoRequestApproval ?? row.auto_request_approval
  };

  const updated = await pool.query(
    `
      UPDATE work_order_sla_rules
      SET
        name = $2,
        enabled = $3,
        applies_priority = $4,
        applies_department = $5,
        breach_after_hours = $6,
        escalation_channel = $7,
        escalation_recipient = $8,
        auto_request_approval = $9,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        site_code AS "siteCode",
        name,
        enabled,
        applies_priority AS "appliesPriority",
        applies_department AS "appliesDepartment",
        breach_after_hours AS "breachAfterHours",
        escalation_channel AS "escalationChannel",
        escalation_recipient AS "escalationRecipient",
        auto_request_approval AS "autoRequestApproval",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      ruleId,
      trimText(merged.name),
      merged.enabled,
      merged.appliesPriority,
      trimText(merged.appliesDepartment) || null,
      merged.breachAfterHours,
      merged.escalationChannel,
      trimText(merged.escalationRecipient),
      merged.autoRequestApproval
    ]
  );

  return updated.rows[0] ?? null;
}

export async function evaluateWorkOrderSlaBreaches(input: {
  siteCode?: string;
  triggeredBy: "manual" | "scheduler";
}) {
  const safeSiteCode = input.siteCode ? normalizeSiteCode(input.siteCode) : null;
  const start = await pool.query(
    `
      INSERT INTO automation_job_runs(job_name, status, details)
      VALUES('work_order_sla_evaluation', 'running', $1::jsonb)
      RETURNING id
    `,
    [JSON.stringify({ triggeredBy: input.triggeredBy, siteCode: safeSiteCode })]
  );
  const jobId = Number(start.rows[0]?.id);

  try {
    const rules = await pool.query(
      `
        SELECT
          id,
          site_code AS "siteCode",
          name,
          applies_priority AS "appliesPriority",
          applies_department AS "appliesDepartment",
          breach_after_hours AS "breachAfterHours",
          escalation_channel AS "escalationChannel",
          escalation_recipient AS "escalationRecipient",
          auto_request_approval AS "autoRequestApproval"
        FROM work_order_sla_rules
        WHERE enabled = TRUE
          AND ($1::text IS NULL OR site_code = $1)
      `,
      [safeSiteCode]
    );

    let escalationsTriggered = 0;
    let autoApprovalsRequested = 0;

    for (const rule of rules.rows) {
      const candidates = await pool.query(
        `
          SELECT
            wo.id,
            wo.work_order_code AS "workOrderCode",
            wo.site_code AS "siteCode",
            wo.department,
            wo.priority,
            wo.status,
            wo.title,
            wo.approval_required AS "approvalRequired",
            wo.created_at AS "createdAt"
          FROM work_orders wo
          WHERE wo.site_code = $1
            AND wo.status <> 'closed'
            AND ($2::text IS NULL OR wo.priority = $2)
            AND ($3::text IS NULL OR wo.department = $3)
            AND EXTRACT(EPOCH FROM (NOW() - wo.created_at)) / 3600.0 >= $4
        `,
        [rule.siteCode, rule.appliesPriority ?? null, rule.appliesDepartment ?? null, Number(rule.breachAfterHours)]
      );

      for (const wo of candidates.rows) {
        const alreadyEscalated = await pool.query(
          `
            SELECT id
            FROM work_order_escalations
            WHERE work_order_id = $1
              AND rule_id = $2
            LIMIT 1
          `,
          [Number(wo.id), Number(rule.id)]
        );

        if (alreadyEscalated.rows[0]) {
          continue;
        }

        const payload = {
          workOrderCode: wo.workOrderCode,
          siteCode: wo.siteCode,
          title: wo.title,
          status: wo.status,
          priority: wo.priority,
          breachedHoursThreshold: Number(rule.breachAfterHours)
        };

        const insertedEscalation = await pool.query(
          `
            INSERT INTO work_order_escalations(work_order_id, rule_id, escalation_type, channel, recipient, payload, status)
            VALUES($1, $2, 'sla_breach', $3, $4, $5::jsonb, 'triggered')
            RETURNING id
          `,
          [Number(wo.id), Number(rule.id), rule.escalationChannel, rule.escalationRecipient, JSON.stringify(payload)]
        );

        const escalationId = Number(insertedEscalation.rows[0]?.id);

        try {
          await dispatchNotification({
            channel: rule.escalationChannel,
            recipient: rule.escalationRecipient,
            subject: `[IRONLOG] SLA breach ${String(wo.workOrderCode)}`,
            message: `Work order ${String(wo.workOrderCode)} breached SLA threshold (${String(rule.breachAfterHours)}h). Priority=${String(wo.priority)}, Status=${String(wo.status)}.`
          });

          await pool.query(
            "UPDATE work_order_escalations SET status = 'sent', attempts = 1, next_retry_at = NULL, last_error = NULL WHERE id = $1",
            [escalationId]
          );
        } catch (error) {
          const deliveryError = error instanceof Error ? error.message : "unknown";
          await pool.query(
            `
              UPDATE work_order_escalations
              SET
                status = 'failed',
                attempts = 1,
                next_retry_at = $2::timestamptz,
                last_error = $3,
                payload = COALESCE(payload, '{}'::jsonb) || $4::jsonb
              WHERE id = $1
            `,
            [escalationId, nextRetryTimestamp(1), deliveryError, JSON.stringify({ deliveryError })]
          );
        }

        await pool.query(
          `
            INSERT INTO work_order_events(work_order_id, event_type, message, metadata)
            VALUES($1, 'sla_breach', $2, $3::jsonb)
          `,
          [
            Number(wo.id),
            `SLA breach triggered via rule ${String(rule.name)}`,
            JSON.stringify({ ruleId: Number(rule.id), escalationId, thresholdHours: Number(rule.breachAfterHours) })
          ]
        );

        escalationsTriggered += 1;

        if (Boolean(rule.autoRequestApproval) && !Boolean(wo.approvalRequired) && String(wo.status) !== "pending_approval") {
          await pool.query(
            `
              UPDATE work_orders
              SET
                status = 'pending_approval',
                approval_required = TRUE,
                approval_reason = COALESCE(approval_reason, 'Auto-escalated due to SLA breach'),
                updated_at = NOW()
              WHERE id = $1
            `,
            [Number(wo.id)]
          );

          await pool.query(
            `
              INSERT INTO work_order_events(work_order_id, event_type, message, metadata)
              VALUES($1, 'approval_requested', 'Auto approval requested after SLA breach', $2::jsonb)
            `,
            [Number(wo.id), JSON.stringify({ ruleId: Number(rule.id) })]
          );

          autoApprovalsRequested += 1;
        }
      }
    }

    const result = {
      siteCode: safeSiteCode,
      rulesEvaluated: rules.rowCount,
      escalationsTriggered,
      autoApprovalsRequested
    };

    await pool.query(
      `
        UPDATE automation_job_runs
        SET status = 'success', details = $2::jsonb, finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify({ triggeredBy: input.triggeredBy, result })]
    );

    return { jobId, ...result };
  } catch (error) {
    await pool.query(
      `
        UPDATE automation_job_runs
        SET status = 'failed', details = $2::jsonb, finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify({ triggeredBy: input.triggeredBy, error: error instanceof Error ? error.message : "unknown" })]
    );
    throw error;
  }
}

export async function listEscalations(siteCode: string, limit = 100) {
  const safeSiteCode = normalizeSiteCode(siteCode);
  const safeLimit = Math.max(10, Math.min(limit, 200));

  const result = await pool.query(
    `
      SELECT
        e.id,
        e.work_order_id AS "workOrderId",
        wo.work_order_code AS "workOrderCode",
        wo.site_code AS "siteCode",
        wo.title,
        e.escalation_type AS "escalationType",
        e.channel,
        e.recipient,
        e.payload,
        e.status,
        e.attempts,
        e.next_retry_at AS "nextRetryAt",
        e.last_error AS "lastError",
        e.created_at AS "createdAt"
      FROM work_order_escalations e
      JOIN work_orders wo ON wo.id = e.work_order_id
      WHERE wo.site_code = $1
      ORDER BY e.created_at DESC
      LIMIT $2
    `,
    [safeSiteCode, safeLimit]
  );

  return { items: result.rows };
}

export async function retryPendingEscalations(limit = 50) {
  const safeLimit = Math.max(10, Math.min(limit, 200));
  const queued = await pool.query(
    `
      SELECT
        e.id,
        e.work_order_id AS "workOrderId",
        e.channel,
        e.recipient,
        e.attempts,
        e.payload,
        wo.work_order_code AS "workOrderCode"
      FROM work_order_escalations e
      JOIN work_orders wo ON wo.id = e.work_order_id
      WHERE e.status = 'failed'
        AND e.channel IN ('teams_webhook', 'whatsapp_webhook')
        AND (e.next_retry_at IS NULL OR e.next_retry_at <= NOW())
        AND e.attempts < 5
      ORDER BY e.created_at ASC
      LIMIT $1
    `,
    [safeLimit]
  );

  let retried = 0;
  let sent = 0;
  let failed = 0;

  for (const item of queued.rows) {
    retried += 1;
    try {
      await dispatchNotification({
        channel: item.channel,
        recipient: item.recipient,
        subject: `[IRONLOG] Escalation retry ${String(item.workOrderCode ?? "-")}`,
        message: `Escalation retry for work order ${String(item.workOrderCode ?? "-")}.`
      });

      await pool.query(
        `
          UPDATE work_order_escalations
          SET status = 'sent', attempts = attempts + 1, next_retry_at = NULL, last_error = NULL
          WHERE id = $1
        `,
        [Number(item.id)]
      );
      sent += 1;
    } catch (error) {
      const nextAttempts = Number(item.attempts ?? 0) + 1;
      const errorMessage = error instanceof Error ? error.message : "unknown";

      await pool.query(
        `
          UPDATE work_order_escalations
          SET
            attempts = $2,
            next_retry_at = $3::timestamptz,
            last_error = $4,
            payload = COALESCE(payload, '{}'::jsonb) || $5::jsonb
          WHERE id = $1
        `,
        [Number(item.id), nextAttempts, nextRetryTimestamp(nextAttempts), errorMessage, JSON.stringify({ retryError: errorMessage })]
      );
      failed += 1;
    }
  }

  return {
    scanned: queued.rowCount,
    retried,
    sent,
    failed
  };
}

export async function uploadWorkOrderAttachment(input: {
  workOrderId: number;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  notes?: string;
  uploadedBy: string;
}) {
  const woResult = await pool.query(
    `
      SELECT id, work_order_code AS "workOrderCode", site_code AS "siteCode"
      FROM work_orders
      WHERE id = $1
      LIMIT 1
    `,
    [input.workOrderId]
  );

  const wo = woResult.rows[0];
  if (!wo) {
    return null;
  }

  const safeName = safeFileName(trimText(input.fileName) || `evidence-${Date.now()}.bin`);
  const safeMimeType = trimText(input.mimeType).toLowerCase();

  if (!allowedAttachmentMimeTypes.has(safeMimeType)) {
    throw new Error(`Unsupported MIME type: ${safeMimeType}`);
  }

  const buffer = base64ToBuffer(input.contentBase64);

  if (buffer.length === 0) {
    throw new Error("Attachment is empty");
  }

  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("Attachment exceeds 8MB limit");
  }

  const folder = path.join(evidenceDir, String(wo.workOrderCode));
  await fs.mkdir(folder, { recursive: true });

  const storedFileName = `${Date.now()}-${safeName}`;
  const filePath = path.join(folder, storedFileName);
  await fs.writeFile(filePath, buffer);

  const inserted = await pool.query(
    `
      INSERT INTO work_order_attachments(
        work_order_id,
        file_name,
        mime_type,
        file_path,
        file_size_bytes,
        uploaded_by,
        notes
      )
      VALUES($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        work_order_id AS "workOrderId",
        file_name AS "fileName",
        mime_type AS "mimeType",
        file_size_bytes AS "fileSizeBytes",
        notes,
        created_at AS "createdAt"
    `,
    [input.workOrderId, safeName, safeMimeType, filePath, buffer.length, input.uploadedBy, input.notes ?? null]
  );

  await pool.query(
    `
      INSERT INTO work_order_events(work_order_id, event_type, message, actor_user_id, metadata)
      VALUES($1, 'attachment_uploaded', $2, $3, $4::jsonb)
    `,
    [input.workOrderId, `Evidence uploaded: ${safeName}`, input.uploadedBy, JSON.stringify({ fileName: safeName, fileSizeBytes: buffer.length })]
  );

  return inserted.rows[0];
}

export async function listWorkOrderAttachments(workOrderId: number) {
  const result = await pool.query(
    `
      SELECT
        id,
        work_order_id AS "workOrderId",
        file_name AS "fileName",
        mime_type AS "mimeType",
        file_size_bytes AS "fileSizeBytes",
        notes,
        (CASE WHEN mime_type IN ('image/jpeg', 'image/png', 'image/webp') THEN TRUE ELSE FALSE END) AS "isPreviewable",
        created_at AS "createdAt"
      FROM work_order_attachments
      WHERE work_order_id = $1
      ORDER BY created_at DESC
    `,
    [workOrderId]
  );

  return { items: result.rows };
}

export async function getWorkOrderAttachment(attachmentId: number) {
  const result = await pool.query(
    `
      SELECT
        a.id,
        a.work_order_id AS "workOrderId",
        a.file_name AS "fileName",
        a.mime_type AS "mimeType",
        a.file_path AS "filePath",
        wo.site_code AS "siteCode"
      FROM work_order_attachments a
      JOIN work_orders wo ON wo.id = a.work_order_id
      WHERE a.id = $1
      LIMIT 1
    `,
    [attachmentId]
  );

  return result.rows[0] ?? null;
}

export async function generateExecutiveShiftReportPdf(input: {
  siteCode: string;
  requestedBy?: string | null;
  triggeredBy: "manual" | "scheduler";
}) {
  const siteCode = normalizeSiteCode(input.siteCode);
  const requestUserId = input.requestedBy ?? "00000000-0000-0000-0000-000000000000";

  const start = await pool.query(
    `
      INSERT INTO automation_job_runs(job_name, status, details)
      VALUES('work_order_executive_report', 'running', $1::jsonb)
      RETURNING id
    `,
    [JSON.stringify({ siteCode, triggeredBy: input.triggeredBy })]
  );
  const jobId = Number(start.rows[0]?.id);

  try {
    await fs.mkdir(executiveReportDir, { recursive: true });

    const [board, attribution, scorecard] = await Promise.all([
      getShiftCommandBoard(siteCode),
      getWorkOrderAttribution(siteCode, 24 * 7),
      getRoleScorecard(siteCode, { id: requestUserId, roles: ["admin"], permissions: ["system.admin"] }, 30)
    ]);

    const fileName = `executive-shift-${siteCode}-${Date.now()}.pdf`;
    const filePath = path.join(executiveReportDir, fileName);

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const stream = doc.pipe(createWriteStream(filePath));

      doc.fontSize(18).text("IRONLOG Executive Shift Report", { align: "left" });
      doc.moveDown(0.3);
      doc.fontSize(11).text(`Site: ${siteCode}`);
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.moveDown(0.8);

      const backlog = (board.backlog ?? {}) as Record<string, unknown>;
      doc.fontSize(13).text("Shift Command Snapshot", { underline: true });
      doc.fontSize(10).text(`Open: ${String(backlog.open ?? 0)} | Assigned: ${String(backlog.assigned ?? 0)} | In Progress: ${String(backlog.inProgress ?? 0)} | Blocked: ${String(backlog.blocked ?? 0)} | Pending Approval: ${String(backlog.pendingApproval ?? 0)}`);
      doc.moveDown(0.7);

      const cards = (scorecard.cards ?? {}) as Record<string, unknown>;
      doc.fontSize(13).text("Role Scorecard", { underline: true });
      doc.fontSize(10).text(`Active Work Orders: ${String(cards.activeWorkOrders ?? 0)}`);
      doc.text(`Pending Approvals: ${String(cards.pendingApprovals ?? 0)}`);
      doc.text(`Overdue Work Orders: ${String(cards.overdueWorkOrders ?? 0)}`);
      doc.text(`Total Actual Cost: ${String(cards.totalActualCost ?? 0)}`);
      doc.text(`Total Downtime Hours: ${String(cards.totalDowntimeHours ?? 0)}`);
      doc.moveDown(0.7);

      doc.fontSize(13).text("Top Machine Cost/Downtime", { underline: true });
      const byMachine = ((attribution.byMachine ?? []) as Array<Record<string, unknown>>).slice(0, 8);
      if (byMachine.length === 0) {
        doc.fontSize(10).text("No attribution records found.");
      } else {
        for (const item of byMachine) {
          doc.fontSize(10).text(
            `${String(item.machineCode ?? "-")} | WO: ${String(item.workOrders ?? 0)} | Cost: ${String(item.actualCost ?? 0)} | Down: ${String(item.downtimeHours ?? 0)}h`
          );
        }
      }

      doc.moveDown(0.7);
      doc.fontSize(13).text("Pending Approvals", { underline: true });
      const pendingApprovals = ((board.pendingApprovals ?? []) as Array<Record<string, unknown>>).slice(0, 8);
      if (pendingApprovals.length === 0) {
        doc.fontSize(10).text("No pending approvals.");
      } else {
        for (const item of pendingApprovals) {
          doc.fontSize(10).text(
            `${String(item.workOrderCode ?? "-")} | ${String(item.title ?? "-")} | Priority=${String(item.priority ?? "-")} | EstCost=${String(item.estimatedCost ?? 0)}`
          );
        }
      }

      doc.end();

      stream.on("finish", () => resolve());
      stream.on("error", (err) => reject(err));
    });

    const inserted = await pool.query(
      `
        INSERT INTO export_artifacts(artifact_type, site_code, file_name, file_path, metadata, created_by)
        VALUES('executive_shift_report_pdf', $1, $2, $3, $4::jsonb, $5)
        RETURNING id, file_name AS "fileName", created_at AS "createdAt"
      `,
      [siteCode, fileName, filePath, JSON.stringify({ jobId }), input.requestedBy ?? null]
    );

    const report = {
      artifactId: Number(inserted.rows[0]?.id),
      fileName,
      filePath
    };

    await pool.query(
      `
        UPDATE automation_job_runs
        SET status = 'success', details = $2::jsonb, finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify({ siteCode, triggeredBy: input.triggeredBy, report })]
    );

    return { jobId, ...report };
  } catch (error) {
    await pool.query(
      `
        UPDATE automation_job_runs
        SET status = 'failed', details = $2::jsonb, finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify({ siteCode, triggeredBy: input.triggeredBy, error: error instanceof Error ? error.message : "unknown" })]
    );
    throw error;
  }
}

export async function runExecutiveShiftReportDispatch(triggeredBy: "manual" | "scheduler") {
  const recipients = config.executiveShiftReportRecipients;
  if (recipients.length === 0) {
    return { dispatched: false, reason: "no_recipients" };
  }

  const report = await generateExecutiveShiftReportPdf({
    siteCode: config.executiveShiftReportDefaultSiteCode,
    requestedBy: null,
    triggeredBy
  });

  const results: Array<{ recipient: string; sent: boolean; reason?: string }> = [];
  for (const recipient of recipients) {
    const sent = await sendMail({
      to: recipient,
      subject: `IRONLOG Executive Shift Report ${config.executiveShiftReportDefaultSiteCode}`,
      text: `Attached is the latest executive shift report for ${config.executiveShiftReportDefaultSiteCode}.`,
      attachments: [{ filename: report.fileName, path: report.filePath }]
    });

    results.push({ recipient, sent: sent.sent, reason: sent.reason });
  }

  return {
    dispatched: true,
    report,
    recipients: results
  };
}

export { isPreviewableImageMime };
