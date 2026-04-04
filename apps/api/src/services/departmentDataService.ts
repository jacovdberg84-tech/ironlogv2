type Timestamped = { timestamp: string };

function isoHoursAgo(hoursAgo: number) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

export function getOperationsDump() {
  const fleetPerformance = [
    { machineCode: "EQ-1001", tonnes: 1220, cycleTimeMin: 19.8, availabilityPct: 92.1, fuelLiters: 560 },
    { machineCode: "EQ-1002", tonnes: 1184, cycleTimeMin: 20.4, availabilityPct: 90.6, fuelLiters: 545 },
    { machineCode: "EQ-1007", tonnes: 1106, cycleTimeMin: 22.1, availabilityPct: 88.4, fuelLiters: 532 },
    { machineCode: "EQ-1010", tonnes: 982, cycleTimeMin: 23.7, availabilityPct: 85.9, fuelLiters: 517 }
  ];

  const shiftTimeline: Array<Timestamped & { shift: string; tonnesHauled: number; activeTrucks: number }> = [
    { timestamp: isoHoursAgo(12), shift: "night", tonnesHauled: 4340, activeTrucks: 18 },
    { timestamp: isoHoursAgo(4), shift: "day", tonnesHauled: 4810, activeTrucks: 19 }
  ];

  return { fleetPerformance, shiftTimeline };
}

export function getHseDump() {
  const incidents = [
    { incidentCode: "HSE-2401", category: "near_miss", severity: "low", area: "Pit A", status: "closed", loggedAt: isoHoursAgo(96) },
    { incidentCode: "HSE-2402", category: "equipment", severity: "high", area: "Workshop", status: "open", loggedAt: isoHoursAgo(42) },
    { incidentCode: "HSE-2403", category: "slip_trip_fall", severity: "warning", area: "ROM Pad", status: "investigating", loggedAt: isoHoursAgo(19) }
  ];

  const actions = [
    { actionCode: "ACT-330", owner: "HSE Officer", dueAt: isoHoursAgo(-18), status: "todo", title: "Refresher toolbox talk on walkway discipline" },
    { actionCode: "ACT-331", owner: "Maintenance Supervisor", dueAt: isoHoursAgo(-8), status: "in_progress", title: "Repair workshop drainage near bay 3" },
    { actionCode: "ACT-332", owner: "Shift Boss", dueAt: isoHoursAgo(3), status: "done", title: "Verify PPE compliance on blast crew" }
  ];

  return { incidents, actions };
}

export function getHrDump() {
  const workforceByCrew = [
    { crew: "Day A", headcount: 64, onShift: 58, overtimeHours: 19 },
    { crew: "Day B", headcount: 61, onShift: 54, overtimeHours: 27 },
    { crew: "Night A", headcount: 62, onShift: 56, overtimeHours: 22 },
    { crew: "Night B", headcount: 61, onShift: 55, overtimeHours: 25 }
  ];

  const trainingExpiring = [
    { employeeNo: "EMP-0109", name: "P. Mokoena", competency: "Rigging", expiresAt: isoHoursAgo(-120) },
    { employeeNo: "EMP-0242", name: "S. Ndlovu", competency: "First Aid", expiresAt: isoHoursAgo(-96) },
    { employeeNo: "EMP-0378", name: "K. Botha", competency: "Defensive Driving", expiresAt: isoHoursAgo(-72) }
  ];

  return { workforceByCrew, trainingExpiring };
}

export function getQualityDump() {
  const labResults = [
    { sampleId: "LAB-991", source: "Pit A", feGradePct: 63.1, sio2Pct: 4.9, moisturePct: 7.8, status: "approved" },
    { sampleId: "LAB-992", source: "Pit C", feGradePct: 61.4, sio2Pct: 5.4, moisturePct: 8.2, status: "hold" },
    { sampleId: "LAB-993", source: "Stockpile 2", feGradePct: 62.7, sio2Pct: 5.0, moisturePct: 7.6, status: "approved" }
  ];

  const nonConformances = [
    { ncCode: "NC-440", process: "Sampling", owner: "QA Lead", status: "open", openedAt: isoHoursAgo(60) },
    { ncCode: "NC-441", process: "Blending", owner: "Plant Metallurgist", status: "in_progress", openedAt: isoHoursAgo(27) }
  ];

  return { labResults, nonConformances };
}

export function getLogisticsDump() {
  const trips = [
    { tripNo: "TRP-810", route: "Mine -> Rail", etaHours: 2.5, status: "in_transit", onTime: true },
    { tripNo: "TRP-811", route: "Mine -> Port", etaHours: 5.2, status: "delayed", onTime: false },
    { tripNo: "TRP-812", route: "Mine -> Rail", etaHours: 1.1, status: "loading", onTime: true }
  ];

  const inventoryWatch = [
    { itemCode: "EXP-ANFO", itemName: "ANFO", daysOfCover: 5, reorderAtDays: 4, risk: "medium" },
    { itemCode: "TYR-40R", itemName: "40R Tyres", daysOfCover: 3, reorderAtDays: 5, risk: "high" },
    { itemCode: "LUB-15W", itemName: "Engine Oil 15W", daysOfCover: 9, reorderAtDays: 6, risk: "low" }
  ];

  return { trips, inventoryWatch };
}
