import jwt from "jsonwebtoken";
import type { AuthenticatedUser } from "../middleware/auth.js";
import { config } from "../config.js";

type JwtPayload = {
  sub: string;
  email: string;
  permissions?: string[];
};

export function verifyAccessToken(token: string): AuthenticatedUser {
  const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  return {
    id: payload.sub,
    email: payload.email,
    roles: [],
    permissions: payload.permissions ?? []
  };
}
