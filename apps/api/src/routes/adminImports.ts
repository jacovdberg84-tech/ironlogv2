import { Router } from "express";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { pool } from "../db/pool.js";

export const adminImportsRouter = Router();

const importPayloadSchema = z
  .object({
    csv: z.string().optional(),
    rows: z.array(z.record(z.any())).optional()
  })
  .refine((value) => (value.csv?.trim() || value.rows?.length), {
    message: "Provide csv or rows"
  });

const assetSchema = z.object({
  assetCode: z.string().min(2),
  name: z.string().min(2),
  category: z.string().default("general"),
  status: z.string().default("active"),
  location: z.string().default("unknown")
});

const fuelSchema = z.object({
  entryDate: z.string().min(8),
  machineCode: z.string().min(2),
  liters: z.coerce.number().nonnegative(),
  unitCost: z.coerce.number().nonnegative(),
  totalCost: z.coerce.number().nonnegative().optional(),
  sourceRef: z.string().optional()
});

const storeSchema = z.object({
  itemCode: z.string().min(2),
  name: z.string().min(2),
  unit: z.string().min(1),
  currentStock: z.coerce.number().nonnegative(),
  reorderLevel: z.coerce.number().nonnegative(),
  location: z.string().default("main-store")
});

const hoursSchema = z.object({
  entryDate: z.string().min(8),
  machineCode: z.string().min(2),
  shiftName: z.string().default("day"),
  operatorName: z.string().optional(),
  hoursRun: z.coerce.number().nonnegative(),
  hoursAvailable: z.coerce.number().nonnegative()
});

function toCamelKey(key: string) {
  const cleaned = key.trim().replace(/[-_\s]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ""));
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function normalizeRow(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[toCamelKey(key)] = value;
  }
  return output;
}

function extractRows(reqBody: unknown) {
  const parsed = importPayloadSchema.safeParse(reqBody);
  if (!parsed.success) {
    throw new Error("Invalid import payload");
  }

  if (parsed.data.rows?.length) {
    return parsed.data.rows.map((row) => normalizeRow(row as Record<string, unknown>));
  }

  const csv = parsed.data.csv ?? "";
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Array<Record<string, unknown>>;

  return records.map((row) => normalizeRow(row));
}

async function logAuditEvent(args: {
  actorUserId?: string;
  action: string;
  targetType: string;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `
      INSERT INTO rbac_audit_logs(actor_user_id, action, target_type, metadata)
      VALUES($1, $2, $3, $4::jsonb)
    `,
    [args.actorUserId ?? null, args.action, args.targetType, JSON.stringify(args.metadata ?? {})]
  );
}

adminImportsRouter.post("/assets", async (req, res) => {
  try {
    const rows = extractRows(req.body).map((row) => assetSchema.parse(row));

    for (const row of rows) {
      await pool.query(
        `
          INSERT INTO assets(asset_code, name, category, status, location, updated_at)
          VALUES($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (asset_code)
          DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            status = EXCLUDED.status,
            location = EXCLUDED.location,
            updated_at = NOW()
        `,
        [row.assetCode, row.name, row.category, row.status, row.location]
      );
    }

    await logAuditEvent({
      actorUserId: req.user?.id,
      action: "import.assets.upsert",
      targetType: "assets",
      metadata: { rowCount: rows.length }
    });

    return res.json({ imported: rows.length, entity: "assets" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

adminImportsRouter.post("/fuel", async (req, res) => {
  try {
    const rows = extractRows(req.body).map((row) => fuelSchema.parse(row));

    for (const row of rows) {
      const totalCost = row.totalCost ?? Number((row.liters * row.unitCost).toFixed(2));
      await pool.query(
        `
          INSERT INTO fuel_entries(entry_date, machine_code, liters, unit_cost, total_cost, source_ref, updated_at)
          VALUES($1::date, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (entry_date, machine_code)
          DO UPDATE SET
            liters = EXCLUDED.liters,
            unit_cost = EXCLUDED.unit_cost,
            total_cost = EXCLUDED.total_cost,
            source_ref = EXCLUDED.source_ref,
            updated_at = NOW()
        `,
        [row.entryDate, row.machineCode, row.liters, row.unitCost, totalCost, row.sourceRef ?? null]
      );
    }

    await logAuditEvent({
      actorUserId: req.user?.id,
      action: "import.fuel.upsert",
      targetType: "fuel_entries",
      metadata: { rowCount: rows.length }
    });

    return res.json({ imported: rows.length, entity: "fuel" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

adminImportsRouter.post("/stores", async (req, res) => {
  try {
    const rows = extractRows(req.body).map((row) => storeSchema.parse(row));

    for (const row of rows) {
      await pool.query(
        `
          INSERT INTO store_items(item_code, name, unit, current_stock, reorder_level, location, updated_at)
          VALUES($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (item_code)
          DO UPDATE SET
            name = EXCLUDED.name,
            unit = EXCLUDED.unit,
            current_stock = EXCLUDED.current_stock,
            reorder_level = EXCLUDED.reorder_level,
            location = EXCLUDED.location,
            updated_at = NOW()
        `,
        [row.itemCode, row.name, row.unit, row.currentStock, row.reorderLevel, row.location]
      );
    }

    await logAuditEvent({
      actorUserId: req.user?.id,
      action: "import.stores.upsert",
      targetType: "store_items",
      metadata: { rowCount: rows.length }
    });

    return res.json({ imported: rows.length, entity: "stores" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

adminImportsRouter.post("/hours", async (req, res) => {
  try {
    const rows = extractRows(req.body).map((row) => hoursSchema.parse(row));

    for (const row of rows) {
      await pool.query(
        `
          INSERT INTO equipment_hours(entry_date, machine_code, shift_name, operator_name, hours_run, hours_available, updated_at)
          VALUES($1::date, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (entry_date, machine_code, shift_name)
          DO UPDATE SET
            operator_name = EXCLUDED.operator_name,
            hours_run = EXCLUDED.hours_run,
            hours_available = EXCLUDED.hours_available,
            updated_at = NOW()
        `,
        [
          row.entryDate,
          row.machineCode,
          row.shiftName,
          row.operatorName ?? null,
          row.hoursRun,
          row.hoursAvailable
        ]
      );
    }

    await logAuditEvent({
      actorUserId: req.user?.id,
      action: "import.hours.upsert",
      targetType: "equipment_hours",
      metadata: { rowCount: rows.length }
    });

    return res.json({ imported: rows.length, entity: "hours" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});
