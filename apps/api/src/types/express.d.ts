import type { AuthenticatedUser } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      correlationId?: string;
    }
  }
}

export {};
