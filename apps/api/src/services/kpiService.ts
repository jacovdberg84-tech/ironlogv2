import { equipment } from "../data.js";

export function getMaintenanceKpis() {
  const totalHoursRun = equipment.reduce((sum, eq) => sum + eq.hoursRun, 0);
  const totalBreakdowns = equipment.reduce((sum, eq) => sum + eq.breakdowns, 0);
  const totalRepairHours = equipment.reduce((sum, eq) => sum + eq.repairHours, 0);

  const mtbf = totalBreakdowns > 0 ? totalHoursRun / totalBreakdowns : totalHoursRun;
  const mttr = totalBreakdowns > 0 ? totalRepairHours / totalBreakdowns : 0;

  return {
    mtbf: Number(mtbf.toFixed(2)),
    mttr: Number(mttr.toFixed(2)),
    lttr: Number(mttr.toFixed(2)),
    breakdownCount: totalBreakdowns
  };
}

export function getAvailabilityAndUtilization() {
  return equipment.map((eq) => {
    const availability = eq.hoursAvailable > 0 ? (eq.hoursRun / eq.hoursAvailable) * 100 : 0;
    const utilization = eq.hoursAvailable > 0
      ? ((eq.hoursRun - eq.repairHours) / eq.hoursAvailable) * 100
      : 0;

    return {
      id: eq.id,
      name: eq.name,
      availability: Number(Math.max(0, availability).toFixed(2)),
      utilization: Number(Math.max(0, utilization).toFixed(2)),
      fuelLiters: eq.fuelLiters
    };
  });
}
