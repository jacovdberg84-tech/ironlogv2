import path from "path";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  createArtifactDownloadToken,
  getCrossSiteComparison,
  getEnterpriseExportBundle,
  getEnterpriseOverview,
  getEnterpriseTrends,
  persistEnterpriseExportBundle,
  resolveArtifactByToken,
  runSyntheticLoadJob
} from "../services/enterpriseService.js";
import { getUserSiteRole, hasRequiredSiteRole } from "../services/siteAccessService.js";

export const enterpriseRouter = Router();

const overviewQuerySchema = z.object({
  hours: z.coerce.number().min(24).max(24 * 30).optional().default(24 * 7),
  siteCode: z.string().min(2).max(20).optional()
});

const trendQuerySchema = z.object({
  hours: z.coerce.number().min(24).max(24 * 30).optional().default(24 * 7),
  siteCode: z.string().min(2).max(20).optional(),
  bucketHours: z.coerce.number().min(6).max(24).optional().default(24)
});

const syntheticLoadSchema = z.object({
  days: z.number().int().min(1).max(90).default(14),
  machines: z.array(z.string().min(2)).max(50).default(["EQ-1001", "EQ-1002", "EQ-1007", "EQ-1010"]),
  eventsPerDayPerMachine: z.number().int().min(1).max(20).default(4),
  includeCriticalSpike: z.boolean().default(true),
  siteCode: z.string().min(2).max(20).optional(),
  scenarioTemplate: z.enum(["normal", "stress", "incident_surge"]).optional()
});

const artifactParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const tokenParamsSchema = z.object({
  token: z.string().min(10)
});

function resolveSiteCode(siteCode?: string) {
  return (siteCode ?? "SITE-A").trim().toUpperCase();
}

async function ensureSiteRole(
  req: any,
  res: any,
  requiredRole: "viewer" | "operator" | "manager" | "admin",
  siteCodeRaw?: string
) {
  const siteCode = resolveSiteCode(siteCodeRaw);

  const isSystemAdmin = req.user?.permissions.includes("system.admin") ?? false;
  if (isSystemAdmin) {
    return { allowed: true, siteCode };
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return { allowed: false, siteCode };
  }

  const role = await getUserSiteRole(userId, siteCode);
  if (!hasRequiredSiteRole(role, requiredRole)) {
    res.status(403).json({ error: "Forbidden", siteCode, requiredRole });
    return { allowed: false, siteCode };
  }

  return { allowed: true, siteCode };
}

enterpriseRouter.get("/overview", async (req, res) => {
  const parsed = overviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const data = await getEnterpriseOverview(parsed.data.hours, access.siteCode);
  return res.json(data);
});

enterpriseRouter.get("/trends", async (req, res) => {
  const parsed = trendQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const trends = await getEnterpriseTrends(parsed.data.hours, access.siteCode, parsed.data.bucketHours);
  return res.json(trends);
});

enterpriseRouter.get("/cross-site-comparison", async (req, res) => {
  const parsed = overviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const isSystemAdmin = req.user?.permissions.includes("system.admin") ?? false;
  if (!isSystemAdmin) {
    return res.status(403).json({ error: "System admin required" });
  }

  const result = await getCrossSiteComparison(parsed.data.hours);
  return res.json(result);
});

enterpriseRouter.get("/export-bundle", async (req, res) => {
  const parsed = overviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const bundle = await getEnterpriseExportBundle(parsed.data.hours, access.siteCode);
  return res.json(bundle);
});

enterpriseRouter.post("/export-bundle/persist", async (req, res) => {
  const parsed = overviewQuerySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "manager", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const artifact = await persistEnterpriseExportBundle(parsed.data.hours, access.siteCode, req.user?.id ?? null);
  return res.status(201).json(artifact);
});

enterpriseRouter.get("/export-artifacts", async (req, res) => {
  const parsed = overviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const artifacts = await pool.query(
    `
      SELECT id, artifact_type AS "artifactType", site_code AS "siteCode", file_name AS "fileName", metadata, created_at AS "createdAt"
      FROM export_artifacts
      WHERE site_code = $1
      ORDER BY created_at DESC
      LIMIT 50
    `,
    [access.siteCode]
  );

  return res.json({ items: artifacts.rows });
});

enterpriseRouter.get("/export-artifacts/:id/download", async (req, res) => {
  const parsed = artifactParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id", details: parsed.error.flatten() });
  }

  const artifact = await pool.query(
    `
      SELECT id, site_code AS "siteCode", file_name AS "fileName", file_path AS "filePath"
      FROM export_artifacts
      WHERE id = $1
      LIMIT 1
    `,
    [parsed.data.id]
  );

  const row = artifact.rows[0];
  if (!row) {
    return res.status(404).json({ error: "Artifact not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(row.siteCode));
  if (!access.allowed) {
    return;
  }

  return res.download(path.resolve(String(row.filePath)), String(row.fileName));
});

enterpriseRouter.post("/export-artifacts/:id/token", async (req, res) => {
  const parsed = artifactParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id", details: parsed.error.flatten() });
  }

  const artifact = await pool.query(
    `
      SELECT site_code AS "siteCode"
      FROM export_artifacts
      WHERE id = $1
      LIMIT 1
    `,
    [parsed.data.id]
  );

  const row = artifact.rows[0];
  if (!row) {
    return res.status(404).json({ error: "Artifact not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(row.siteCode));
  if (!access.allowed) {
    return;
  }

  const tokenResult = await createArtifactDownloadToken(parsed.data.id, req.user?.id ?? null);
  return res.json({
    artifactId: parsed.data.id,
    token: tokenResult.token,
    expiresAt: tokenResult.expiresAt,
    downloadUrl: `/api/enterprise/export-artifacts/token/${tokenResult.token}/download`
  });
});

enterpriseRouter.get("/export-artifacts/token/:token/download", async (req, res) => {
  const parsed = tokenParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid token", details: parsed.error.flatten() });
  }

  const artifact = await resolveArtifactByToken(parsed.data.token);
  if (!artifact) {
    return res.status(404).json({ error: "Token invalid or expired" });
  }

  return res.download(path.resolve(artifact.filePath), artifact.fileName);
});

enterpriseRouter.post("/synthetic-load", async (req, res) => {
  const parsed = syntheticLoadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "manager", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const result = await runSyntheticLoadJob({ ...parsed.data, siteCode: access.siteCode }, "manual");
  return res.status(201).json(result);
});

enterpriseRouter.get("/synthetic-load/runs", async (req, res) => {
  const parsed = overviewQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const runs = await pool.query(
    `
      SELECT id, job_name AS "jobName", status, details, started_at AS "startedAt", finished_at AS "finishedAt"
      FROM automation_job_runs
      WHERE job_name = 'synthetic_site_load'
        AND (details->'result'->>'siteCode') = $1
      ORDER BY started_at DESC
      LIMIT 50
    `,
    [access.siteCode]
  );

  return res.json({ items: runs.rows });
});
