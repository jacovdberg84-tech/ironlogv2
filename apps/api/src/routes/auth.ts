import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

const logoutSchema = z.object({
  refreshToken: z.string().min(20)
});

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const loginRateLimit = new Map<string, RateLimitEntry>();

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString("hex");
}

function getClientIp(rawIp: string | undefined) {
  if (!rawIp) {
    return "unknown";
  }

  return rawIp.replace(/^::ffff:/, "");
}

function enforceLoginRateLimit(ip: string) {
  const now = Date.now();
  const existing = loginRateLimit.get(ip);

  if (!existing || now > existing.resetAt) {
    loginRateLimit.set(ip, {
      count: 1,
      resetAt: now + config.loginRateLimitWindowMs
    });
    return null;
  }

  existing.count += 1;
  loginRateLimit.set(ip, existing);

  if (existing.count > config.loginRateLimitMax) {
    const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
    return {
      retryAfterSeconds
    };
  }

  return null;
}

async function issueAuthTokens(args: {
  userId: string;
  email: string;
  ip: string;
  userAgent: string;
}) {
  if (!config.jwtSecret) {
    throw new Error("JWT secret not configured");
  }

  const accessTokenOptions: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"]
  };

  const accessToken = jwt.sign({ sub: args.userId, email: args.email }, config.jwtSecret, accessTokenOptions);
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + config.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000).toISOString();

  await pool.query(
    `
      INSERT INTO auth_refresh_tokens(user_id, token_hash, expires_at, created_ip, created_user_agent)
      VALUES($1, $2, $3::timestamptz, $4, $5)
    `,
    [args.userId, refreshTokenHash, expiresAt, args.ip, args.userAgent]
  );

  return {
    accessToken,
    refreshToken
  };
}

authRouter.post("/login", async (req, res) => {
  const ip = getClientIp(req.ip);
  const rateLimitResult = enforceLoginRateLimit(ip);
  if (rateLimitResult) {
    res.setHeader("Retry-After", String(rateLimitResult.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many login attempts from this IP",
      retryAfterSeconds: rateLimitResult.retryAfterSeconds
    });
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const result = await pool.query(
    `
      SELECT
        id,
        email,
        password_hash,
        is_active,
        failed_login_attempts,
        lockout_until
      FROM users
      WHERE email = $1
    `,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.lockout_until && new Date(user.lockout_until).getTime() > Date.now()) {
    return res.status(423).json({ error: "Account temporarily locked. Try again later." });
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    const failedAttempts = Number(user.failed_login_attempts ?? 0) + 1;
    const shouldLock = failedAttempts >= config.loginMaxAttempts;

    await pool.query(
      `
        UPDATE users
        SET
          failed_login_attempts = $2,
          lockout_until = CASE
            WHEN $3::boolean THEN NOW() + ($4::text || ' minutes')::interval
            ELSE lockout_until
          END,
          updated_at = NOW()
        WHERE id = $1
      `,
      [user.id, failedAttempts, shouldLock, String(config.loginLockoutMinutes)]
    );

    return res.status(401).json({ error: "Invalid credentials" });
  }

  await pool.query(
    `
      UPDATE users
      SET failed_login_attempts = 0, lockout_until = NULL, updated_at = NOW()
      WHERE id = $1
    `,
    [user.id]
  );

  const tokens = await issueAuthTokens({
    userId: user.id,
    email: user.email,
    ip,
    userAgent: req.header("user-agent") ?? "unknown"
  });

  return res.json({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      id: user.id,
      email: user.email
    }
  });
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const submittedRefreshToken = parsed.data.refreshToken;
  const submittedHash = hashToken(submittedRefreshToken);

  const tokenResult = await pool.query(
    `
      SELECT
        rt.id,
        rt.user_id,
        rt.expires_at,
        rt.revoked_at,
        u.email,
        u.is_active
      FROM auth_refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1
    `,
    [submittedHash]
  );

  const tokenRow = tokenResult.rows[0];
  if (!tokenRow) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  if (tokenRow.revoked_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return res.status(401).json({ error: "Refresh token expired or revoked" });
  }

  if (!tokenRow.is_active) {
    return res.status(401).json({ error: "User inactive" });
  }

  await pool.query("UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE id = $1", [tokenRow.id]);

  const tokens = await issueAuthTokens({
    userId: tokenRow.user_id,
    email: tokenRow.email,
    ip: getClientIp(req.ip),
    userAgent: req.header("user-agent") ?? "unknown"
  });

  return res.json({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken
  });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const submittedHash = hashToken(parsed.data.refreshToken);
  await pool.query(
    `
      UPDATE auth_refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND user_id = $2
    `,
    [submittedHash, req.user?.id]
  );

  return res.json({ loggedOut: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});
