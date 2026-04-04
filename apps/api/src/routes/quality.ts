import { Router } from "express";
import { getQualityDump } from "../services/departmentDataService.js";

export const qualityRouter = Router();

qualityRouter.get("/summary", (_req, res) => {
  res.json({
    documentsPendingReview: 13,
    samplesProcessed: 78,
    averageFeGradePercent: 62.4,
    nonConformanceOpen: 3
  });
});

qualityRouter.get("/dump", (_req, res) => {
  res.json(getQualityDump());
});
