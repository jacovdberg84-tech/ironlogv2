import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import JSZip from "jszip";
import { pool } from "../db/pool.js";
import {
  getHseDump,
  getHrDump,
  getLogisticsDump,
  getOperationsDump,
  getQualityDump
} from "./departmentDataService.js";
import { getIronmindIntelOverview } from "./ironmindIntelService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exportsDir = path.resolve(__dirname, "../../reports/exports");

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function normalizeSiteCode(siteCode?: string | null) {
  const raw = (siteCode ?? "SITE-A").trim().toUpperCase();
  return raw.length > 0 ? raw : "SITE-A";
}

function machinePrefix(siteCode: string) {
  return `${siteCode}-`;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    return "";
  }

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export async function getEnterpriseOverview(hours: number, siteCode?: string | null) {
  const safeHours = Math.max(24, Math.min(hours, 24 * 30));
  const safeSiteCode = normalizeSiteCode(siteCode);
  const prefix = machinePrefix(safeSiteCode);

  const [opsDump, hseDump, hrDump, qualityDump, logisticsDump, ironmindOverview] = await Promise.all([
    Promise.resolve(getOperationsDump()),
    Promise.resolve(getHseDump()),
    Promise.resolve(getHrDump()),
    Promise.resolve(getQualityDump()),
    Promise.resolve(getLogisticsDump()),
    getIronmindIntelOverview(safeHours)
  ]);

  const fuelResult = await pool.query<{ liters: number; totalCost: number }>(
    `
      SELECT
        COALESCE(SUM(liters), 0)::float AS liters,
        COALESCE(SUM(total_cost), 0)::float AS "totalCost"
      FROM fuel_entries
      WHERE entry_date >= CURRENT_DATE - (($1::int / 24)::int)
        AND machine_code LIKE $2
    `,
    [safeHours, `${prefix}%`]
  );

  const hoursResult = await pool.query<{ runHours: number; availHours: number }>(
    `
      SELECT
        COALESCE(SUM(hours_run), 0)::float AS "runHours",
        COALESCE(SUM(hours_available), 0)::float AS "availHours"
      FROM equipment_hours
      WHERE entry_date >= CURRENT_DATE - (($1::int / 24)::int)
        AND machine_code LIKE $2
    `,
    [safeHours, `${prefix}%`]
  );

  const totals = {
    fuelLiters: fuelResult.rows[0]?.liters ?? 0,
    fuelCost: fuelResult.rows[0]?.totalCost ?? 0,
    runHours: hoursResult.rows[0]?.runHours ?? 0,
    availableHours: hoursResult.rows[0]?.availHours ?? 0
  };

  const utilizationPct = totals.availableHours > 0 ? round((totals.runHours / totals.availableHours) * 100) : 0;
  const fuelCostPerRunHour = totals.runHours > 0 ? round(totals.fuelCost / totals.runHours) : 0;

  return {
    generatedAt: new Date().toISOString(),
    windowHours: safeHours,
    siteCode: safeSiteCode,
    enterpriseKpis: {
      utilizationPct,
      fuelCostPerRunHour,
      criticalFaultRatioPct: ironmindOverview.totals.criticalRatio,
      openHseIncidents: hseDump.incidents.filter((item) => item.status !== "closed").length,
      expiringTrainingCount: hrDump.trainingExpiring.length,
      delayedTrips: logisticsDump.trips.filter((item) => item.status === "delayed").length
    },
    operations: opsDump,
    hse: hseDump,
    hr: hrDump,
    quality: qualityDump,
    logistics: logisticsDump,
    ironmind: ironmindOverview,
    totals
  };
}

export async function getEnterpriseTrends(hours: number, siteCode?: string | null, bucketHours = 24) {
  const safeHours = Math.max(24, Math.min(hours, 24 * 30));
  const safeBucket = Math.max(6, Math.min(bucketHours, 24));
  const safeSiteCode = normalizeSiteCode(siteCode);
  const prefix = machinePrefix(safeSiteCode);

  const days = Math.max(1, Math.ceil(safeHours / 24));

  const [fuel, runHours, faults] = await Promise.all([
    pool.query<{ bucketDate: string; liters: number; totalCost: number }>(
      `
        SELECT
          entry_date::text AS "bucketDate",
          COALESCE(SUM(liters), 0)::float AS liters,
          COALESCE(SUM(total_cost), 0)::float AS "totalCost"
        FROM fuel_entries
        WHERE entry_date >= CURRENT_DATE - $1::int
          AND machine_code LIKE $2
        GROUP BY entry_date
        ORDER BY entry_date
      `,
      [days, `${prefix}%`]
    ),
    pool.query<{ bucketDate: string; runHours: number; availHours: number }>(
      `
        SELECT
          entry_date::text AS "bucketDate",
          COALESCE(SUM(hours_run), 0)::float AS "runHours",
          COALESCE(SUM(hours_available), 0)::float AS "availHours"
        FROM equipment_hours
        WHERE entry_date >= CURRENT_DATE - $1::int
          AND machine_code LIKE $2
        GROUP BY entry_date
        ORDER BY entry_date
      `,
      [days, `${prefix}%`]
    ),
    pool.query<{ bucketDate: string; count: number; criticalCount: number }>(
      `
        SELECT
          DATE(occurred_at)::text AS "bucketDate",
          COUNT(*)::int AS count,
          SUM(CASE WHEN severity IN ('high', 'critical') THEN 1 ELSE 0 END)::int AS "criticalCount"
        FROM fault_events
        WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 hour')
          AND machine_code LIKE $2
        GROUP BY DATE(occurred_at)
        ORDER BY DATE(occurred_at)
      `,
      [safeHours, `${prefix}%`]
    )
  ]);

  return {
    siteCode: safeSiteCode,
    windowHours: safeHours,
    bucketHours: safeBucket,
    series: {
      fuel: fuel.rows,
      runHours: runHours.rows,
      faults: faults.rows
    }
  };
}

export async function generateSyntheticSiteData(input: {
  days: number;
  machines: string[];
  eventsPerDayPerMachine: number;
  includeCriticalSpike: boolean;
  siteCode?: string;
  scenarioTemplate?: "normal" | "stress" | "incident_surge";
}) {
  const scenarioTemplate = input.scenarioTemplate ?? "normal";

  const templateDefaults: Record<"normal" | "stress" | "incident_surge", { days: number; eventsPerDayPerMachine: number; includeCriticalSpike: boolean }> = {
    normal: { days: 14, eventsPerDayPerMachine: 3, includeCriticalSpike: false },
    stress: { days: 30, eventsPerDayPerMachine: 8, includeCriticalSpike: true },
    incident_surge: { days: 7, eventsPerDayPerMachine: 12, includeCriticalSpike: true }
  };

  const selectedTemplate = templateDefaults[scenarioTemplate];

  const days = Math.max(1, Math.min(input.days || selectedTemplate.days, 90));
  const eventsPerDayPerMachine = Math.max(1, Math.min(input.eventsPerDayPerMachine || selectedTemplate.eventsPerDayPerMachine, 20));
  const includeCriticalSpike = input.includeCriticalSpike ?? selectedTemplate.includeCriticalSpike;
  const safeSiteCode = normalizeSiteCode(input.siteCode);
  const machines = input.machines.length > 0 ? input.machines.slice(0, 50) : ["EQ-1001", "EQ-1002", "EQ-1007", "EQ-1010"];
  const normalizedMachines = machines.map((machine) => {
    const trimmed = machine.trim().toUpperCase();
    return trimmed.startsWith(`${safeSiteCode}-`) ? trimmed : `${safeSiteCode}-${trimmed}`;
  });
  const faultCodes = ["HYD-LEAK", "ENG-TEMP", "ELEC-CTRL", "TYR-DMG", "BRAKE-PRES"];
  const severities: Array<"low" | "warning" | "high" | "critical"> = ["low", "warning", "high", "critical"];

  let faultEventsInserted = 0;
  let fuelRowsUpserted = 0;
  let hoursRowsUpserted = 0;

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - dayOffset);
    const entryDate = date.toISOString().slice(0, 10);

    for (const machineCode of normalizedMachines) {
      const hoursAvailable = 12;
      const hoursRun = Math.max(6, 12 - (dayOffset % 4) - Math.random() * 2.5);
      const liters = round(420 + Math.random() * 190, 2);
      const unitCost = round(2.1 + Math.random() * 0.5, 4);
      const totalCost = round(liters * unitCost, 2);

      await pool.query(
        `
          INSERT INTO equipment_hours(entry_date, machine_code, shift_name, operator_name, hours_run, hours_available, updated_at)
          VALUES($1::date, $2, 'day', 'Synthetic Loader', $3, $4, NOW())
          ON CONFLICT (entry_date, machine_code, shift_name)
          DO UPDATE SET
            operator_name = EXCLUDED.operator_name,
            hours_run = EXCLUDED.hours_run,
            hours_available = EXCLUDED.hours_available,
            updated_at = NOW()
        `,
        [entryDate, machineCode, round(hoursRun, 2), hoursAvailable]
      );
      hoursRowsUpserted += 1;

      await pool.query(
        `
          INSERT INTO fuel_entries(entry_date, machine_code, liters, unit_cost, total_cost, source_ref, updated_at)
          VALUES($1::date, $2, $3, $4, $5, 'synthetic_generator', NOW())
          ON CONFLICT (entry_date, machine_code)
          DO UPDATE SET
            liters = EXCLUDED.liters,
            unit_cost = EXCLUDED.unit_cost,
            total_cost = EXCLUDED.total_cost,
            source_ref = EXCLUDED.source_ref,
            updated_at = NOW()
        `,
        [entryDate, machineCode, liters, unitCost, totalCost]
      );
      fuelRowsUpserted += 1;

      for (let i = 0; i < eventsPerDayPerMachine; i += 1) {
        const occurredAt = new Date(`${entryDate}T${String((i * 2) % 24).padStart(2, "0")}:00:00.000Z`).toISOString();
        const faultCode = faultCodes[(dayOffset + i) % faultCodes.length];

        let severity = severities[(dayOffset + i) % severities.length];
        if (includeCriticalSpike && dayOffset < 2 && i % 3 === 0) {
          severity = "critical";
        }

        await pool.query(
          `
            INSERT INTO fault_events(machine_code, fault_code, severity, notes, occurred_at)
            VALUES($1, $2, $3, $4, $5::timestamptz)
          `,
          [machineCode, faultCode, severity, "Synthetic generated event", occurredAt]
        );

        faultEventsInserted += 1;
      }
    }
  }

  return {
    siteCode: safeSiteCode,
    days,
    machineCount: normalizedMachines.length,
    scenarioTemplate,
    eventsPerDayPerMachine,
    includeCriticalSpike,
    inserted: {
      faultEvents: faultEventsInserted,
      fuelRows: fuelRowsUpserted,
      hoursRows: hoursRowsUpserted
    }
  };
}

export async function runSyntheticLoadJob(
  input: {
    days: number;
    machines: string[];
    eventsPerDayPerMachine: number;
    includeCriticalSpike: boolean;
    siteCode?: string;
    scenarioTemplate?: "normal" | "stress" | "incident_surge";
  },
  triggeredBy: "manual" | "scheduler"
) {
  const start = await pool.query(
    `
      INSERT INTO automation_job_runs(job_name, status, details)
      VALUES('synthetic_site_load', 'running', $1::jsonb)
      RETURNING id
    `,
    [JSON.stringify({ triggeredBy, input })]
  );

  const jobId = start.rows[0]?.id as number;

  try {
    const result = await generateSyntheticSiteData(input);

    await pool.query(
      `
        UPDATE automation_job_runs
        SET status = 'success', details = $2::jsonb, finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify({ triggeredBy, result })]
    );

    return { jobId, ...result };
  } catch (error) {
    await pool.query(
      `
        UPDATE automation_job_runs
        SET status = 'failed', details = $2::jsonb, finished_at = NOW()
        WHERE id = $1
      `,
      [jobId, JSON.stringify({ triggeredBy, error: error instanceof Error ? error.message : "unknown" })]
    );
    throw error;
  }
}

export async function getEnterpriseExportBundle(hours: number, siteCode?: string | null) {
  const safeSiteCode = normalizeSiteCode(siteCode);
  const overview = await getEnterpriseOverview(hours, safeSiteCode);

  const jsonBundle = {
    metadata: {
      generatedAt: new Date().toISOString(),
      siteCode: safeSiteCode,
      windowHours: hours
    },
    enterpriseOverview: overview,
    operations: overview.operations,
    hse: overview.hse,
    hr: overview.hr,
    quality: overview.quality,
    logistics: overview.logistics,
    ironmind: overview.ironmind
  };

  const csvBundle: Record<string, string> = {
    operations_fleetPerformance: toCsv((overview.operations as { fleetPerformance?: Array<Record<string, unknown>> })?.fleetPerformance ?? []),
    operations_shiftTimeline: toCsv((overview.operations as { shiftTimeline?: Array<Record<string, unknown>> })?.shiftTimeline ?? []),
    hse_incidents: toCsv((overview.hse as { incidents?: Array<Record<string, unknown>> })?.incidents ?? []),
    hse_actions: toCsv((overview.hse as { actions?: Array<Record<string, unknown>> })?.actions ?? []),
    hr_workforceByCrew: toCsv((overview.hr as { workforceByCrew?: Array<Record<string, unknown>> })?.workforceByCrew ?? []),
    hr_trainingExpiring: toCsv((overview.hr as { trainingExpiring?: Array<Record<string, unknown>> })?.trainingExpiring ?? []),
    quality_labResults: toCsv((overview.quality as { labResults?: Array<Record<string, unknown>> })?.labResults ?? []),
    quality_nonConformances: toCsv((overview.quality as { nonConformances?: Array<Record<string, unknown>> })?.nonConformances ?? []),
    logistics_trips: toCsv((overview.logistics as { trips?: Array<Record<string, unknown>> })?.trips ?? []),
    logistics_inventoryWatch: toCsv((overview.logistics as { inventoryWatch?: Array<Record<string, unknown>> })?.inventoryWatch ?? []),
    ironmind_topFaults: toCsv((overview.ironmind as { topFaults?: Array<Record<string, unknown>> })?.topFaults ?? []),
    ironmind_hotMachines: toCsv((overview.ironmind as { hotMachines?: Array<Record<string, unknown>> })?.hotMachines ?? []),
    enterprise_kpis: toCsv([overview.enterpriseKpis as Record<string, unknown>]),
    enterprise_totals: toCsv([overview.totals as Record<string, unknown>])
  };

  return {
    metadata: jsonBundle.metadata,
    json: jsonBundle,
    csv: csvBundle
  };
}

export async function persistEnterpriseExportBundle(hours: number, siteCode?: string | null, createdBy: string | null = null) {
  const bundle = await getEnterpriseExportBundle(hours, siteCode);

  await fs.mkdir(exportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `enterprise-bundle-${bundle.metadata.siteCode}-${timestamp}.zip`;
  const filePath = path.join(exportsDir, fileName);

  const zip = new JSZip();
  zip.file("bundle.json", JSON.stringify(bundle.json, null, 2));

  const csvFolder = zip.folder("csv");
  if (csvFolder) {
    for (const [name, csv] of Object.entries(bundle.csv)) {
      csvFolder.file(`${name}.csv`, csv);
    }
  }

  const zipBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await fs.writeFile(filePath, zipBytes);

  const inserted = await pool.query(
    `
      INSERT INTO export_artifacts(artifact_type, site_code, file_name, file_path, metadata, created_by)
      VALUES('enterprise_bundle_zip', $1, $2, $3, $4::jsonb, $5)
      RETURNING id, artifact_type AS "artifactType", site_code AS "siteCode", file_name AS "fileName", created_at AS "createdAt"
    `,
    [bundle.metadata.siteCode, fileName, filePath, JSON.stringify(bundle.metadata), createdBy]
  );

  const retentionCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const old = await pool.query<{ id: number; filePath: string }>(
    `
      SELECT id, file_path AS "filePath"
      FROM export_artifacts
      WHERE artifact_type = 'enterprise_bundle_zip'
        AND created_at < $1::timestamptz
    `,
    [retentionCutoff]
  );

  for (const row of old.rows) {
    try {
      await fs.unlink(String(row.filePath));
    } catch {
      // Ignore missing files and keep DB cleanup going.
    }
  }

  if (old.rows.length > 0) {
    await pool.query(
      `
        DELETE FROM export_artifacts
        WHERE id = ANY($1::bigint[])
      `,
      [old.rows.map((row) => row.id)]
    );
  }

  return inserted.rows[0];
}

export async function createArtifactDownloadToken(artifactId: number, createdBy: string | null, minutes = 30) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(5, Math.min(120, minutes)) * 60 * 1000).toISOString();

  await pool.query(
    `
      INSERT INTO export_artifact_tokens(artifact_id, token, expires_at, created_by)
      VALUES($1, $2, $3::timestamptz, $4)
    `,
    [artifactId, token, expiresAt, createdBy]
  );

  return {
    token,
    expiresAt
  };
}

export async function resolveArtifactByToken(token: string) {
  const result = await pool.query(
    `
      SELECT
        t.id AS "tokenId",
        a.id AS "artifactId",
        a.file_name AS "fileName",
        a.file_path AS "filePath",
        a.site_code AS "siteCode",
        t.expires_at AS "expiresAt",
        t.consumed_at AS "consumedAt"
      FROM export_artifact_tokens t
      JOIN export_artifacts a ON a.id = t.artifact_id
      WHERE t.token = $1
      LIMIT 1
    `,
    [token]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  if (row.consumedAt) {
    return null;
  }

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return null;
  }

  await pool.query(
    `
      UPDATE export_artifact_tokens
      SET consumed_at = NOW()
      WHERE id = $1
    `,
    [row.tokenId]
  );

  return {
    artifactId: Number(row.artifactId),
    fileName: String(row.fileName),
    filePath: String(row.filePath),
    siteCode: String(row.siteCode)
  };
}

export async function getCrossSiteComparison(hours: number) {
  const safeHours = Math.max(24, Math.min(hours, 24 * 30));

  const sitesResult = await pool.query<{ siteCode: string; name: string }>(
    `
      SELECT site_code AS "siteCode", name
      FROM sites
      WHERE is_active = TRUE
      ORDER BY site_code
      LIMIT 20
    `
  );

  const rows: Array<{
    siteCode: string;
    siteName: string;
    utilizationPct: number;
    fuelCostPerRunHour: number;
    criticalFaultRatioPct: number;
    delayedTrips: number;
    openHseIncidents: number;
  }> = [];

  for (const site of sitesResult.rows) {
    const overview = await getEnterpriseOverview(safeHours, site.siteCode);
    rows.push({
      siteCode: site.siteCode,
      siteName: site.name,
      utilizationPct: Number((overview.enterpriseKpis as any).utilizationPct ?? 0),
      fuelCostPerRunHour: Number((overview.enterpriseKpis as any).fuelCostPerRunHour ?? 0),
      criticalFaultRatioPct: Number((overview.enterpriseKpis as any).criticalFaultRatioPct ?? 0),
      delayedTrips: Number((overview.enterpriseKpis as any).delayedTrips ?? 0),
      openHseIncidents: Number((overview.enterpriseKpis as any).openHseIncidents ?? 0)
    });
  }

  const avg = (key: keyof (typeof rows)[number]) => {
    if (rows.length === 0) {
      return 0;
    }
    return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length;
  };

  const baseline = {
    utilizationPct: avg("utilizationPct"),
    fuelCostPerRunHour: avg("fuelCostPerRunHour"),
    criticalFaultRatioPct: avg("criticalFaultRatioPct"),
    delayedTrips: avg("delayedTrips"),
    openHseIncidents: avg("openHseIncidents")
  };

  const variance = rows.map((row) => ({
    ...row,
    variance: {
      utilizationPct: round(row.utilizationPct - baseline.utilizationPct),
      fuelCostPerRunHour: round(row.fuelCostPerRunHour - baseline.fuelCostPerRunHour),
      criticalFaultRatioPct: round(row.criticalFaultRatioPct - baseline.criticalFaultRatioPct),
      delayedTrips: round(row.delayedTrips - baseline.delayedTrips),
      openHseIncidents: round(row.openHseIncidents - baseline.openHseIncidents)
    }
  }));

  return {
    generatedAt: new Date().toISOString(),
    windowHours: safeHours,
    baseline,
    items: variance
  };
}
