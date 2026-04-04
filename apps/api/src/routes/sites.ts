import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getUserSiteRole, hasRequiredSiteRole, listUserSites } from "../services/siteAccessService.js";

export const sitesRouter = Router();

const createSiteSchema = z.object({
  siteCode: z.string().min(2).max(20),
  name: z.string().min(3).max(120),
  region: z.string().max(120).optional(),
  isActive: z.boolean().optional().default(true)
});

const grantAccessSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["viewer", "operator", "manager", "admin"])
});

sitesRouter.get("/", async (req, res) => {
  const isSystemAdmin = req.user?.permissions.includes("system.admin") ?? false;
  const items = await listUserSites(req.user!.id, isSystemAdmin);
  return res.json({ items });
});

sitesRouter.post("/", async (req, res) => {
  const isSystemAdmin = req.user?.permissions.includes("system.admin") ?? false;
  if (!isSystemAdmin) {
    return res.status(403).json({ error: "System admin required" });
  }

  const parsed = createSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const result = await pool.query(
    `
      INSERT INTO sites(site_code, name, region, is_active, updated_at)
      VALUES($1, $2, $3, $4, NOW())
      ON CONFLICT (site_code)
      DO UPDATE SET
        name = EXCLUDED.name,
        region = EXCLUDED.region,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING id, site_code AS "siteCode", name, region, is_active AS "isActive"
    `,
    [data.siteCode.toUpperCase(), data.name, data.region ?? null, data.isActive]
  );

  return res.status(201).json({ site: result.rows[0] });
});

sitesRouter.post("/:siteId/access", async (req, res) => {
  const isSystemAdmin = req.user?.permissions.includes("system.admin") ?? false;
  if (!isSystemAdmin) {
    return res.status(403).json({ error: "System admin required" });
  }

  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) {
    return res.status(400).json({ error: "Invalid site id" });
  }

  const parsed = grantAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  await pool.query(
    `
      INSERT INTO user_site_access(user_id, site_id, role)
      VALUES($1, $2, $3)
      ON CONFLICT (user_id, site_id)
      DO UPDATE SET role = EXCLUDED.role
    `,
    [parsed.data.userId, siteId, parsed.data.role]
  );

  return res.json({ granted: true });
});

sitesRouter.get("/:siteCode/context", async (req, res) => {
  const siteCode = String(req.params.siteCode ?? "").trim().toUpperCase();
  if (!siteCode) {
    return res.status(400).json({ error: "Invalid site code" });
  }

  const isSystemAdmin = req.user?.permissions.includes("system.admin") ?? false;
  const role = isSystemAdmin ? "admin" : await getUserSiteRole(req.user!.id, siteCode);

  if (!role) {
    return res.status(403).json({ error: "No access to site", siteCode });
  }

  const result = await pool.query(
    `
      SELECT id, site_code AS "siteCode", name, region, is_active AS "isActive"
      FROM sites
      WHERE site_code = $1
      LIMIT 1
    `,
    [siteCode]
  );

  const site = result.rows[0];
  if (!site || site.isActive === false) {
    return res.status(404).json({ error: "Site not found or inactive", siteCode });
  }

  return res.json({
    site,
    role,
    allowedSections: {
      overview: hasRequiredSiteRole(role, "viewer"),
      ironmind: hasRequiredSiteRole(role, "operator"),
      departments: hasRequiredSiteRole(role, "viewer"),
      enterprise: hasRequiredSiteRole(role, "manager"),
      admin: isSystemAdmin
    }
  });
});
