import { pool } from "../db/pool.js";

const roleRank: Record<string, number> = {
  viewer: 1,
  operator: 2,
  manager: 3,
  admin: 4
};

function rank(role: string) {
  return roleRank[role] ?? 0;
}

export function hasRequiredSiteRole(actualRole: string | null, requiredRole: "viewer" | "operator" | "manager" | "admin") {
  return rank(actualRole ?? "") >= rank(requiredRole);
}

export async function getUserSiteRole(userId: string, siteCode: string) {
  const result = await pool.query<{ role: string }>(
    `
      SELECT usa.role
      FROM user_site_access usa
      JOIN sites s ON s.id = usa.site_id
      WHERE usa.user_id = $1
        AND s.site_code = $2
        AND s.is_active = TRUE
      LIMIT 1
    `,
    [userId, siteCode.toUpperCase()]
  );

  return result.rows[0]?.role ?? null;
}

export async function listUserSites(userId: string, isSystemAdmin: boolean) {
  if (isSystemAdmin) {
    const result = await pool.query(
      `
        SELECT id, site_code AS "siteCode", name, region, is_active AS "isActive", 'admin'::text AS role
        FROM sites
        ORDER BY site_code
      `
    );
    return result.rows;
  }

  const result = await pool.query(
    `
      SELECT
        s.id,
        s.site_code AS "siteCode",
        s.name,
        s.region,
        s.is_active AS "isActive",
        usa.role
      FROM user_site_access usa
      JOIN sites s ON s.id = usa.site_id
      WHERE usa.user_id = $1
        AND s.is_active = TRUE
      ORDER BY s.site_code
    `,
    [userId]
  );

  return result.rows;
}
