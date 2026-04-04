import { Router } from "express";
import { getHseDump } from "../services/departmentDataService.js";

export const hseRouter = Router();

hseRouter.get("/summary", (_req, res) => {
  res.json({
    incidentsOpen: 4,
    observationsLogged: 22,
    actionsDue: 11,
    complianceScore: 93.4
  });
});

hseRouter.get("/dump", (_req, res) => {
  res.json(getHseDump());
});
