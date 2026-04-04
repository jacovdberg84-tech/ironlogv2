import { Router } from "express";
import { getOperationsDump } from "../services/departmentDataService.js";

export const operationsRouter = Router();

operationsRouter.get("/dashboard", (_req, res) => {
  res.json({
    tonnesHauled: 9150,
    drillingBlastingExpenses: 51900,
    materialProducedTonnes: 8870,
    trucksLoadedToClients: 116,
    fuelCosting: {
      liters: 20450,
      totalCost: 48200,
      costPerLiter: 2.36
    }
  });
});

operationsRouter.get("/dump", (_req, res) => {
  res.json(getOperationsDump());
});
