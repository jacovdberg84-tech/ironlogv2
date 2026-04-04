import { Router } from "express";
import { getHrDump } from "../services/departmentDataService.js";

export const hrRouter = Router();

hrRouter.get("/summary", (_req, res) => {
  res.json({
    totalEmployees: 248,
    onShiftNow: 173,
    trainingCompliancePercent: 96.2,
    leaveRequestsOpen: 9,
    expiringMedicals: 7
  });
});

hrRouter.get("/dump", (_req, res) => {
  res.json(getHrDump());
});
