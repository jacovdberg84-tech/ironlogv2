import { pool } from "../db/pool.js";

type FaultEventRow = {
  machineCode: string;
  faultCode: string;
  severity: "low" | "warning" | "high" | "critical";
  occurredAt: string;
};

type FaultNotificationRow = {
  channel: string;
  status: string;
};

const severityWeights: Record<string, number> = {
  low: 1,
  warning: 2,
  high: 3,
  critical: 5
};

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function getSeverityWeight(severity: string) {
  return severityWeights[severity] ?? 1;
}

export async function getIronmindIntelOverview(hours: number) {
  const safeHours = Math.max(1, Math.min(hours, 24 * 30));

  const eventsResult = await pool.query<FaultEventRow>(
    `
      SELECT
        machine_code AS "machineCode",
        fault_code AS "faultCode",
        severity,
        occurred_at AS "occurredAt"
      FROM fault_events
      WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 hour')
      ORDER BY occurred_at DESC
    `,
    [safeHours]
  );

  const notificationsResult = await pool.query<FaultNotificationRow>(
    `
      SELECT
        COALESCE(r.channel, 'unknown') AS channel,
        fn.status
      FROM fault_notifications fn
      LEFT JOIN fault_notification_rules r ON r.id = fn.rule_id
      WHERE fn.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
    `,
    [safeHours]
  );

  const events = eventsResult.rows;
  const notifications = notificationsResult.rows;

  const faultAgg = new Map<string, { occurrences: number; severityScore: number }>();
  const machineAgg = new Map<string, { occurrences: number; risk: number }>();
  const severityMix = { low: 0, warning: 0, high: 0, critical: 0 };

  for (const event of events) {
    const faultKey = `${event.machineCode}:${event.faultCode}`;
    const weight = getSeverityWeight(event.severity);

    const faultCurrent = faultAgg.get(faultKey) ?? { occurrences: 0, severityScore: 0 };
    faultCurrent.occurrences += 1;
    faultCurrent.severityScore += weight;
    faultAgg.set(faultKey, faultCurrent);

    const machineCurrent = machineAgg.get(event.machineCode) ?? { occurrences: 0, risk: 0 };
    machineCurrent.occurrences += 1;
    machineCurrent.risk += weight;
    machineAgg.set(event.machineCode, machineCurrent);

    severityMix[event.severity] += 1;
  }

  const topFaults = [...faultAgg.entries()]
    .map(([key, value]) => {
      const [machineCode, faultCode] = key.split(":");
      const riskScore = value.occurrences * value.severityScore;
      return {
        machineCode,
        faultCode,
        occurrences: value.occurrences,
        severityScore: value.severityScore,
        riskScore
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  const hotMachines = [...machineAgg.entries()]
    .map(([machineCode, value]) => ({
      machineCode,
      occurrences: value.occurrences,
      riskScore: value.risk
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  const channelHealthMap = new Map<string, { sent: number; failed: number; total: number }>();
  for (const row of notifications) {
    const channel = row.channel || "unknown";
    const bucket = channelHealthMap.get(channel) ?? { sent: 0, failed: 0, total: 0 };
    bucket.total += 1;
    if (row.status === "sent") {
      bucket.sent += 1;
    }
    if (row.status === "failed") {
      bucket.failed += 1;
    }
    channelHealthMap.set(channel, bucket);
  }

  const channelHealth = [...channelHealthMap.entries()].map(([channel, value]) => ({
    channel,
    sent: value.sent,
    failed: value.failed,
    total: value.total,
    successRate: value.total > 0 ? round((value.sent / value.total) * 100) : 0
  }));

  const totalEvents = events.length;
  const totalRisk = events.reduce((sum, event) => sum + getSeverityWeight(event.severity), 0);
  const criticalCount = severityMix.critical;

  return {
    windowHours: safeHours,
    totals: {
      events: totalEvents,
      notifications: notifications.length,
      avgRiskPerEvent: totalEvents > 0 ? round(totalRisk / totalEvents) : 0,
      criticalRatio: totalEvents > 0 ? round((criticalCount / totalEvents) * 100) : 0
    },
    topFaults,
    hotMachines,
    severityMix,
    channelHealth
  };
}

export async function getIronmindIntelTimeline(machineCode: string | null, limit: number) {
  const safeLimit = Math.max(10, Math.min(limit, 200));

  const result = machineCode
    ? await pool.query<FaultEventRow>(
        `
          SELECT
            machine_code AS "machineCode",
            fault_code AS "faultCode",
            severity,
            occurred_at AS "occurredAt"
          FROM fault_events
          WHERE machine_code = $1
          ORDER BY occurred_at DESC
          LIMIT $2
        `,
        [machineCode, safeLimit]
      )
    : await pool.query<FaultEventRow>(
        `
          SELECT
            machine_code AS "machineCode",
            fault_code AS "faultCode",
            severity,
            occurred_at AS "occurredAt"
          FROM fault_events
          ORDER BY occurred_at DESC
          LIMIT $1
        `,
        [safeLimit]
      );

  const counters = new Map<string, number>();
  const timeline = result.rows.map((event) => {
    const key = `${event.machineCode}:${event.faultCode}`;
    const recurrenceCount = (counters.get(key) ?? 0) + 1;
    counters.set(key, recurrenceCount);

    return {
      ...event,
      recurrenceCount,
      riskScore: recurrenceCount * getSeverityWeight(event.severity)
    };
  });

  return {
    machineCode,
    limit: safeLimit,
    timeline
  };
}

export async function getIronmindRecommendations(hours: number) {
  const overview = await getIronmindIntelOverview(hours);
  const recommendations: Array<{
    priority: "P1" | "P2" | "P3";
    title: string;
    action: string;
    owner: string;
    etaHours: number;
    rationale: string;
  }> = [];

  if (overview.totals.criticalRatio >= 20) {
    recommendations.push({
      priority: "P1",
      title: "Critical Fault War Room",
      action: "Trigger same-shift triage for all critical events and assign cross-functional response owner.",
      owner: "Reliability Engineer",
      etaHours: 2,
      rationale: `Critical ratio is ${overview.totals.criticalRatio}%, above threshold.`
    });
  }

  if (overview.hotMachines.length > 0) {
    const hottest = overview.hotMachines[0];
    recommendations.push({
      priority: "P1",
      title: `Stabilize ${hottest.machineCode}`,
      action: "Prioritize planned downtime and inspect hydraulic, electrical, and cooling systems.",
      owner: "Maintenance Superintendent",
      etaHours: 8,
      rationale: `${hottest.machineCode} leads with risk score ${hottest.riskScore}.`
    });
  }

  const worstChannel = overview.channelHealth
    .filter((item) => item.total >= 3)
    .sort((a, b) => a.successRate - b.successRate)[0];

  if (worstChannel && worstChannel.successRate < 90) {
    recommendations.push({
      priority: "P2",
      title: `Fix ${worstChannel.channel} notification reliability`,
      action: "Validate endpoint credentials and add retry/backoff with dead-letter handling.",
      owner: "Platform Engineer",
      etaHours: 6,
      rationale: `Channel success rate is ${worstChannel.successRate}%.`
    });
  }

  for (const fault of overview.topFaults.slice(0, 2)) {
    recommendations.push({
      priority: "P3",
      title: `Eliminate repeat ${fault.faultCode}`,
      action: "Create an RCFA mini-track and update operator pre-start checklist with fault-specific checks.",
      owner: "Asset Owner",
      etaHours: 12,
      rationale: `${fault.machineCode}/${fault.faultCode} repeated ${fault.occurrences} times in window.`
    });
  }

  return {
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    recommendations: recommendations.slice(0, 6)
  };
}

export async function runIronmindWhatIfScenario(input: {
  machineCode: string;
  faultCode: string;
  incomingEvents: number;
  windowHours: number;
}) {
  const safeIncoming = Math.max(0, Math.min(input.incomingEvents, 100));
  const safeWindow = Math.max(1, Math.min(input.windowHours, 24 * 30));

  const historicalResult = await pool.query<{ occurrences: number; avgSeverityScore: number }>(
    `
      SELECT
        COUNT(*)::int AS occurrences,
        AVG(
          CASE severity
            WHEN 'low' THEN 1
            WHEN 'warning' THEN 2
            WHEN 'high' THEN 3
            WHEN 'critical' THEN 5
            ELSE 1
          END
        )::float AS "avgSeverityScore"
      FROM fault_events
      WHERE machine_code = $1
        AND fault_code = $2
        AND occurred_at >= NOW() - ($3::int * INTERVAL '1 hour')
    `,
    [input.machineCode, input.faultCode, safeWindow]
  );

  const baseline = historicalResult.rows[0] ?? { occurrences: 0, avgSeverityScore: 1 };
  const projectedOccurrences = baseline.occurrences + safeIncoming;

  const ruleResult = await pool.query<{ threshold: number }>(
    `
      SELECT occurrence_threshold::int AS threshold
      FROM fault_notification_rules
      WHERE enabled = TRUE
      ORDER BY occurrence_threshold ASC
      LIMIT 1
    `
  );

  const threshold = ruleResult.rows[0]?.threshold ?? 3;
  const projectedRiskScore = round(projectedOccurrences * (baseline.avgSeverityScore || 1), 2);
  const breachLikelihood = threshold > 0 ? Math.min(100, round((projectedOccurrences / threshold) * 100)) : 100;

  return {
    machineCode: input.machineCode,
    faultCode: input.faultCode,
    windowHours: safeWindow,
    baselineOccurrences: baseline.occurrences,
    incomingEvents: safeIncoming,
    projectedOccurrences,
    threshold,
    breachLikelihood,
    projectedRiskScore,
    recommendation:
      projectedOccurrences >= threshold
        ? "Auto-notification threshold likely to breach. Pre-stage spares and assign response owner now."
        : "Threshold likely safe. Continue monitoring and run focused inspection at next planned stop."
  };
}
