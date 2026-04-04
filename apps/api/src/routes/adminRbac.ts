import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool.js";

export const adminRbacRouter = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  roleNames: z.array(z.string().min(2)).default([])
});

const createRoleSchema = z.object({
  name: z.string().min(2),
  permissionNames: z.array(z.string().min(2)).default([])
});

const assignRolesSchema = z.object({
  roleNames: z.array(z.string().min(2)).min(1)
});

const assignPermissionsSchema = z.object({
  permissionNames: z.array(z.string().min(2)).min(1)
});

const auditQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number(value ?? "20");
      if (!Number.isFinite(parsed)) {
        return 20;
      }
      return Math.max(1, Math.min(200, Math.floor(parsed)));
    })
});

async function logAuditEvent(args: {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `
      INSERT INTO rbac_audit_logs(actor_user_id, action, target_type, target_id, metadata)
      VALUES($1, $2, $3, $4, $5::jsonb)
    `,
    [
      args.actorUserId ?? null,
      args.action,
      args.targetType,
      args.targetId ?? null,
      JSON.stringify(args.metadata ?? {})
    ]
  );
}

adminRbacRouter.get("/summary", async (_req, res) => {
  const [usersResult, rolesResult, permissionsResult] = await Promise.all([
    pool.query(`
      SELECT
        u.id,
        u.email,
        u.full_name AS "fullName",
        u.is_active AS "isActive",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name), NULL) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY u.id, u.email, u.full_name, u.is_active
      ORDER BY u.created_at DESC
    `),
    pool.query(`
      SELECT
        r.id,
        r.name,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.name), NULL) AS permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id, r.name
      ORDER BY r.name
    `),
    pool.query(`SELECT id, name FROM permissions ORDER BY name`)
  ]);

  return res.json({
    users: usersResult.rows,
    roles: rolesResult.rows,
    permissions: permissionsResult.rows
  });
});

adminRbacRouter.get("/audit", async (req, res) => {
  const parsed = auditQuerySchema.safeParse(req.query);
  const limit = parsed.success ? parsed.data.limit : 20;

  const result = await pool.query(
    `
      SELECT
        a.id,
        a.action,
        a.target_type AS "targetType",
        a.target_id AS "targetId",
        a.metadata,
        a.created_at AS "createdAt",
        u.email AS "actorEmail"
      FROM rbac_audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return res.json({ items: result.rows });
});

adminRbacRouter.post("/users", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, fullName, password, roleNames } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const passwordHash = await bcrypt.hash(password, 12);

  const userResult = await pool.query(
    `
      INSERT INTO users(email, full_name, password_hash)
      VALUES($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = NOW()
      RETURNING id, email, full_name AS "fullName", is_active AS "isActive"
    `,
    [normalizedEmail, fullName, passwordHash]
  );

  const user = userResult.rows[0];

  if (roleNames.length > 0) {
    await pool.query(
      `
        INSERT INTO user_roles(user_id, role_id)
        SELECT $1, r.id
        FROM roles r
        WHERE r.name = ANY($2::text[])
        ON CONFLICT DO NOTHING
      `,
      [user.id, roleNames]
    );
  }

  await logAuditEvent({
    actorUserId: req.user?.id,
    action: "rbac.user.upsert",
    targetType: "user",
    targetId: user.id,
    metadata: {
      email: user.email,
      roleNames
    }
  });

  return res.status(201).json({ created: user });
});

adminRbacRouter.post("/users/:userId/roles", async (req, res) => {
  const parsed = assignRolesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const userId = req.params.userId;

  await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  await pool.query(
    `
      INSERT INTO user_roles(user_id, role_id)
      SELECT $1, r.id
      FROM roles r
      WHERE r.name = ANY($2::text[])
      ON CONFLICT DO NOTHING
    `,
    [userId, parsed.data.roleNames]
  );

  await logAuditEvent({
    actorUserId: req.user?.id,
    action: "rbac.user.roles.replace",
    targetType: "user",
    targetId: userId,
    metadata: {
      roleNames: parsed.data.roleNames
    }
  });

  return res.json({ updated: true });
});

adminRbacRouter.post("/roles", async (req, res) => {
  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { name, permissionNames } = parsed.data;

  const roleResult = await pool.query(
    `
      INSERT INTO roles(name)
      VALUES($1)
      ON CONFLICT (name)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `,
    [name]
  );

  const role = roleResult.rows[0];

  if (permissionNames.length > 0) {
    await pool.query(
      `
        INSERT INTO role_permissions(role_id, permission_id)
        SELECT $1, p.id
        FROM permissions p
        WHERE p.name = ANY($2::text[])
        ON CONFLICT DO NOTHING
      `,
      [role.id, permissionNames]
    );
  }

  await logAuditEvent({
    actorUserId: req.user?.id,
    action: "rbac.role.upsert",
    targetType: "role",
    targetId: String(role.id),
    metadata: {
      name: role.name,
      permissionNames
    }
  });

  return res.status(201).json({ created: role });
});

adminRbacRouter.post("/roles/:roleId/permissions", async (req, res) => {
  const parsed = assignPermissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const roleId = Number(req.params.roleId);
  if (!Number.isFinite(roleId)) {
    return res.status(400).json({ error: "Invalid role id" });
  }

  await pool.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  await pool.query(
    `
      INSERT INTO role_permissions(role_id, permission_id)
      SELECT $1, p.id
      FROM permissions p
      WHERE p.name = ANY($2::text[])
      ON CONFLICT DO NOTHING
    `,
    [roleId, parsed.data.permissionNames]
  );

  await logAuditEvent({
    actorUserId: req.user?.id,
    action: "rbac.role.permissions.replace",
    targetType: "role",
    targetId: String(roleId),
    metadata: {
      permissionNames: parsed.data.permissionNames
    }
  });

  return res.json({ updated: true });
});
