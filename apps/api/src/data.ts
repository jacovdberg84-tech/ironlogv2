import { Equipment, WeeklyCosting, WorkOrder } from "./types.js";

export const equipment: Equipment[] = [
  {
    id: "EQ-001",
    name: "CAT 777D",
    category: "truck",
    hoursRun: 122,
    hoursAvailable: 168,
    breakdowns: 2,
    repairHours: 11,
    fuelLiters: 980
  },
  {
    id: "EQ-002",
    name: "Primary Crusher A",
    category: "crusher",
    hoursRun: 152,
    hoursAvailable: 168,
    breakdowns: 1,
    repairHours: 5,
    fuelLiters: 320
  },
  {
    id: "EQ-003",
    name: "Drill Rig XR55",
    category: "drill",
    hoursRun: 116,
    hoursAvailable: 168,
    breakdowns: 3,
    repairHours: 18,
    fuelLiters: 745
  }
];

export const workOrders: WorkOrder[] = [
  {
    id: "WO-1001",
    machineId: "EQ-001",
    title: "Hydraulic line inspection",
    status: "open",
    priority: "high",
    createdAt: new Date().toISOString()
  }
];

export const weeklyCosting: WeeklyCosting = {
  week: "2026-W14",
  totalFuelCost: 48200,
  maintenanceCost: 36600,
  drillingBlastingCost: 51900,
  logisticsCost: 22400,
  costPerTonne: 5.8
};
