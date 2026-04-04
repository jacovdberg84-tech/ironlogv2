import cron from "node-cron";
import { config } from "../config.js";
import { runSyntheticLoadJob } from "./enterpriseService.js";
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

  console.log(`Scheduler started. weekly_gm_report cron=${config.weeklyReportCron}`);
}
