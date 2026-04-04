import { Router } from "express";
import { z } from "zod";
import { equipment, weeklyCosting, workOrders } from "../data.js";
import { pool } from "../db/pool.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../permissions.js";
import { WorkOrder } from "../types.js";
import { getAvailabilityAndUtilization, getMaintenanceKpis } from "../services/kpiService.js";

export const plantRouter = Router();

const operatorEntrySchema = z.object({
  entryDate: z.string().min(8),
  machineCode: z.string().min(2),
  shiftName: z.string().default("day"),
  operatorName: z.string().min(2),
  hoursRun: z.number().min(0),
  hoursAvailable: z.number().min(0),
  fuelLiters: z.number().min(0).optional()
});

plantRouter.get("/equipment", (_req, res) => {
  res.json({ items: equipment });
});

plantRouter.get("/kpis", (_req, res) => {
  res.json({
    maintenance: getMaintenanceKpis(),
    availability: getAvailabilityAndUtilization()
  });
});

plantRouter.get("/reports/daily", (_req, res) => {
  res.json({
    date: new Date().toISOString().slice(0, 10),
    summary: {
      activeMachines: equipment.length,
      openWorkOrders: workOrders.filter((wo) => wo.status !== "closed").length,
      totalFuelLiters: equipment.reduce((sum, item) => sum + item.fuelLiters, 0)
    }
  });
});

plantRouter.get("/reports/weekly-costing", (_req, res) => {
  res.json({ data: weeklyCosting });
});

plantRouter.get("/reports/weekly-gm-excel", (_req, res) => {
  res.json({
    fileName: `GM-Weekly-${weeklyCosting.week}.xlsx`,
    sheet: "GM Summary",
    rows: [
      { metric: "Fuel Cost", value: weeklyCosting.totalFuelCost },
      { metric: "Maintenance Cost", value: weeklyCosting.maintenanceCost },
      { metric: "Drilling & Blasting", value: weeklyCosting.drillingBlastingCost },
      { metric: "Logistics Cost", value: weeklyCosting.logisticsCost },
      { metric: "Cost Per Tonne", value: weeklyCosting.costPerTonne }
    ]
  });
});

plantRouter.post("/work-orders/auto-generate", requirePermission(PERMISSIONS.plantWrite), (_req, res) => {
  const wo: WorkOrder = {
    id: `WO-${Math.floor(Math.random() * 9000) + 1000}`,
    machineId: equipment[0]?.id ?? "EQ-UNK",
    title: "Auto-generated preventative maintenance",
    status: "open",
    priority: "medium",
    createdAt: new Date().toISOString()
  };

  workOrders.push(wo);
  res.status(201).json({ created: wo, totalOpen: workOrders.length });
});

plantRouter.post("/operator-entries", requirePermission(PERMISSIONS.plantWrite), async (req, res) => {
  const parsed = operatorEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const data = parsed.data;

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
    [data.entryDate, data.machineCode, data.shiftName, data.operatorName, data.hoursRun, data.hoursAvailable]
  );

  if (typeof data.fuelLiters === "number") {
    await pool.query(
      `
        INSERT INTO fuel_entries(entry_date, machine_code, liters, unit_cost, total_cost, source_ref, updated_at)
        VALUES($1::date, $2, $3, 0, 0, 'operator_capture', NOW())
        ON CONFLICT (entry_date, machine_code)
        DO UPDATE SET
          liters = EXCLUDED.liters,
          updated_at = NOW()
      `,
      [data.entryDate, data.machineCode, data.fuelLiters]
    );
  }

  return res.status(201).json({ saved: true });
});

plantRouter.get("/operator-entries", requirePermission(PERMISSIONS.plantRead), async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;

  const result = await pool.query(
    `
      SELECT
        eh.entry_date AS "entryDate",
        eh.machine_code AS "machineCode",
        eh.shift_name AS "shiftName",
        eh.operator_name AS "operatorName",
        eh.hours_run AS "hoursRun",
        eh.hours_available AS "hoursAvailable",
        fe.liters AS "fuelLiters",
        eh.updated_at AS "updatedAt"
      FROM equipment_hours eh
      LEFT JOIN fuel_entries fe
        ON fe.entry_date = eh.entry_date
       AND fe.machine_code = eh.machine_code
      ORDER BY eh.entry_date DESC, eh.updated_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return res.json({ items: result.rows });
});
