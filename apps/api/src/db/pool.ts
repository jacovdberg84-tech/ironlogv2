import dotenv from "dotenv";
import { Pool } from "pg";
import { config } from "../config.js";

dotenv.config();

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: config.databaseUrl
});
