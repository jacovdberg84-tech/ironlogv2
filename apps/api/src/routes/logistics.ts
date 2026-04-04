import { Router } from "express";
import { getLogisticsDump } from "../services/departmentDataService.js";

export const logisticsRouter = Router();

logisticsRouter.get("/status", (_req, res) => {
  res.json({
    cargoInTransit: 14,
    delayedTrips: 2,
    plannedTripsToday: 27,
    onTimeDeliveryPercent: 91.6,
    supplyChainAlerts: [
      "Tyre shipment delayed by 6h",
      "Port window changed for client batch C-14"
    ]
  });
});

logisticsRouter.get("/dump", (_req, res) => {
  res.json(getLogisticsDump());
});
