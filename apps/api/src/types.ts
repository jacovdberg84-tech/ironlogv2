export type Equipment = {
  id: string;
  name: string;
  category: "store" | "crusher" | "mobile" | "drill" | "truck" | "support";
  hoursRun: number;
  hoursAvailable: number;
  breakdowns: number;
  repairHours: number;
  fuelLiters: number;
};

export type WorkOrder = {
  id: string;
  machineId: string;
  title: string;
  status: "open" | "in-progress" | "closed";
  priority: "low" | "medium" | "high";
  createdAt: string;
};

export type WeeklyCosting = {
  week: string;
  totalFuelCost: number;
  maintenanceCost: number;
  drillingBlastingCost: number;
  logisticsCost: number;
  costPerTonne: number;
};
