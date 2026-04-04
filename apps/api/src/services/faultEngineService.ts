import { pool } from "../db/pool.js";
import { dispatchNotification } from "./notificationChannelService.js";

export async function evaluateFaultRulesForEvent(input: {
  eventId: number;
  machineCode: string;
  faultCode: string;
  occurredAt: string;
}) {
  const rulesResult = await pool.query(
    `
      SELECT id, name, occurrence_threshold AS "occurrenceThreshold", window_hours AS "windowHours", recipient, channel
      FROM fault_notification_rules
      WHERE enabled = TRUE
    `
  );

  const alerts: Array<{ ruleId: number; recipient: string; occurrenceCount: number; channel: string }> = [];

  for (const rule of rulesResult.rows) {
    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM fault_events
        WHERE machine_code = $1
          AND fault_code = $2
          AND occurred_at >= ($3::timestamptz - ($4::text || ' hours')::interval)
      `,
      [input.machineCode, input.faultCode, input.occurredAt, String(rule.windowHours)]
    );

    const count = countResult.rows[0]?.count ?? 0;

    if (count >= rule.occurrenceThreshold) {
      const inserted = await pool.query(
        `
          INSERT INTO fault_notifications(rule_id, machine_code, fault_code, occurrence_count, status, payload)
          VALUES($1, $2, $3, $4, 'triggered', $5::jsonb)
          RETURNING id
        `,
        [
          rule.id,
          input.machineCode,
          input.faultCode,
          count,
          JSON.stringify({
            ruleName: rule.name,
            eventId: input.eventId,
            occurredAt: input.occurredAt
          })
        ]
      );

      const notificationId = inserted.rows[0]?.id as number;

      const subject = `[IRONLOG] Recurring fault detected ${input.machineCode}/${input.faultCode}`;
      const message = `Rule '${rule.name}' triggered with ${count} events in last ${rule.windowHours}h.`;

      try {
        const delivery = await dispatchNotification({
          channel: rule.channel,
          recipient: rule.recipient,
          subject,
          message
        });

        await pool.query(
          `
            UPDATE fault_notifications
            SET status = 'sent', payload = payload || $2::jsonb
            WHERE id = $1
          `,
          [notificationId, JSON.stringify({ delivery })]
        );
      } catch (error) {
        await pool.query(
          `
            UPDATE fault_notifications
            SET status = 'failed', payload = payload || $2::jsonb
            WHERE id = $1
          `,
          [
            notificationId,
            JSON.stringify({
              deliveryError: error instanceof Error ? error.message : "unknown"
            })
          ]
        );
      }

      alerts.push({
        ruleId: rule.id,
        recipient: rule.recipient,
        occurrenceCount: count,
        channel: rule.channel
      });
    }
  }

  return alerts;
}
