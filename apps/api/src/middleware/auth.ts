import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db/pool.js";

export type AuthenticatedUser = {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
};

type JwtPayload = {
  sub: string;
  email: string;
};

export async function resolveUser(userId: string): Promise<AuthenticatedUser | null> {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.email,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name), NULL) AS roles,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.name), NULL) AS permissions
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1 AND u.is_active = TRUE
      GROUP BY u.id, u.email
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    roles: row.roles ?? [],
    permissions: row.permissions ?? []
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const token = auth.slice("Bearer ".length).trim();

  try {
    const secret = config.jwtSecret;
    if (!secret) {
      return res.status(500).json({ error: "JWT secret not configured" });
    }

    const payload = jwt.verify(token, secret) as JwtPayload;
    const user = await resolveUser(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const permissions = req.user?.permissions ?? [];
    const hasAccess = permissions.includes("system.admin") || permissions.includes(permission);

    if (!hasAccess) {
      return res.status(403).json({
        error: "Forbidden",
        requiredPermission: permission
      });
    }

    return next();
  };
}
