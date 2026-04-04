import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const permissions = [
  "system.admin",
  "plant.read",
  "plant.write",
  "operations.read",
  "operations.write",
  "hse.read",
  "hse.write",
  "hr.read",
  "hr.write",
  "quality.read",
  "quality.write",
  "logistics.read",
  "logistics.write",
  "ironmind.read",
  "ironmind.write"
];

async function seed() {
  for (const role of ["admin", "manager", "viewer"]) {
    await pool.query("INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING", [role]);
  }

  for (const permission of permissions) {
    await pool.query("INSERT INTO permissions(name) VALUES($1) ON CONFLICT (name) DO NOTHING", [permission]);
  }

  await pool.query(`
    INSERT INTO role_permissions(role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON true
    WHERE r.name = 'admin'
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    INSERT INTO role_permissions(role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.name LIKE '%.read'
    WHERE r.name = 'viewer'
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    INSERT INTO role_permissions(role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.name <> 'system.admin'
    WHERE r.name = 'manager'
    ON CONFLICT DO NOTHING
  `);

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@ironlog.local";
  const adminName = process.env.ADMIN_NAME ?? "System Admin";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const userResult = await pool.query(
    `
      INSERT INTO users(email, full_name, password_hash)
      VALUES($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id
    `,
    [adminEmail, adminName, passwordHash]
  );

  const userId = userResult.rows[0]?.id as string;

  await pool.query(
    `
      INSERT INTO user_roles(user_id, role_id)
      SELECT $1, r.id FROM roles r WHERE r.name = 'admin'
      ON CONFLICT DO NOTHING
    `,
    [userId]
  );

  await pool.query(
    `
      INSERT INTO sites(site_code, name, region)
      VALUES
        ('SITE-A', 'North Pit Complex', 'North Belt'),
        ('SITE-B', 'South Processing Hub', 'South Belt'),
        ('SITE-C', 'Rail & Port Interface', 'Coastal')
      ON CONFLICT (site_code) DO NOTHING
    `
  );

  await pool.query(
    `
      INSERT INTO user_site_access(user_id, site_id, role)
      SELECT $1, s.id, 'admin'
      FROM sites s
      ON CONFLICT (user_id, site_id) DO UPDATE SET role = EXCLUDED.role
    `,
    [userId]
  );

  console.log(`Seed complete. Admin: ${adminEmail}`);
  await pool.end();
}

seed().catch(async (err) => {
  console.error("Seed failed", err);
  await pool.end();
  process.exit(1);
});
