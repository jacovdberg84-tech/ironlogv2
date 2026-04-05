import cron from "node-cron";
import { config } from "../config.js";
import { runSyntheticLoadJob } from "./enterpriseService.js";
import {
  evaluateWorkOrderSlaBreaches,
  retryPendingEscalations,
  runExecutiveShiftReportDispatch
} from "./workOrderExecutionService.js";
import { runWeeklyReportJob } from "./weeklyReportService.js";

let schedulerStarted = false;

export function startSchedulers() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;

  cron.schedule(config.weeklyReportCron, async () => {
    try {
      await runWeeklyReportJob("scheduler");
      console.log("Weekly GM report job completed");
    } catch (error) {
      console.error("Weekly GM report job failed", error);
    }
  });

  if (config.syntheticLoadCron && config.syntheticLoadCron.toLowerCase() !== "off") {
    cron.schedule(config.syntheticLoadCron, async () => {
      try {
        await runSyntheticLoadJob(
          {
            days: config.syntheticLoadDefaultDays,
            machines: config.syntheticLoadDefaultMachines,
            eventsPerDayPerMachine: config.syntheticLoadDefaultEventsPerDayPerMachine,
            includeCriticalSpike: config.syntheticLoadDefaultIncludeCriticalSpike,
            siteCode: config.syntheticLoadDefaultSiteCode
          },
          "scheduler"
        );
        console.log("Scheduled synthetic site load completed");
      } catch (error) {
        console.error("Scheduled synthetic site load failed", error);
      }
    });
  }

  if (config.workOrderSlaCron && config.workOrderSlaCron.toLowerCase() !== "off") {
    cron.schedule(config.workOrderSlaCron, async () => {
      try {
        await evaluateWorkOrderSlaBreaches({ triggeredBy: "scheduler" });
        console.log("Scheduled work order SLA evaluation completed");
      } catch (error) {
        console.error("Scheduled work order SLA evaluation failed", error);
      }
    });
  }

  if (config.workOrderEscalationRetryCron && config.workOrderEscalationRetryCron.toLowerCase() !== "off") {
    cron.schedule(config.workOrderEscalationRetryCron, async () => {
      try {
        await retryPendingEscalations(100);
        console.log("Scheduled work order escalation retry completed");
      } catch (error) {
        console.error("Scheduled work order escalation retry failed", error);
      }
    });
  }

  if (config.executiveShiftReportCron && config.executiveShiftReportCron.toLowerCase() !== "off") {
    cron.schedule(config.executiveShiftReportCron, async () => {
      try {
        await runExecutiveShiftReportDispatch("scheduler");
        console.log("Scheduled executive shift report dispatch completed");
      } catch (error) {
        console.error("Scheduled executive shift report dispatch failed", error);
      }
    });
  }

  console.log(`Scheduler started. weekly_gm_report cron=${config.weeklyReportCron}`);
}
