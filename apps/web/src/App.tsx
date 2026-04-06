import { useEffect, useMemo, useState } from "react";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  addCaseAction,
  assignRolePermissions,
  assignUserRoles,
  closeInvestigationCase,
  closeWorkOrder,
  createWorkOrder,
  createSite,
  createInvestigationCase,
  createFaultEvent,
  createFaultRule,
  createRbacRole,
  createRbacUser,
  createEnterpriseArtifactToken,
  createWorkOrderChecklistItem,
  createWorkOrderComment,
  deleteFaultRule,
  getCrossSiteComparison,
  getEnterpriseExportBundle,
  getEnterpriseExportArtifacts,
  getEnterpriseOverviewBySite,
  getEnterpriseSyntheticLoadRunsBySite,
  getEnterpriseTrends,
  disableFaultRule,
  getFaultNotifications,
  getFaultRules,
  getHseDump,
  getHrDump,
  getIronmindIntelOverview,
  getIronmindIntelTimeline,
  getIronmindPredictive,
  getIronmindRecommendations,
  getInvestigationCases,
  getLogisticsDump,
  getOperationsDump,
  getQualityDump,
  getRbacAudit,
  getModuleSummary,
  getOperatorEntries,
  getOperationsDashboard,
  getPlantKpis,
  getRbacSummary,
  getWeeklyGmRuns,
  getWorkOrderAttribution,
  getWorkOrderScorecard,
  getWorkOrders,
  getWorkOrderShiftBoard,
  hasToken,
  importCsv,
  importRows,
  login,
  PlantKpiResponse,
  RbacAuditItem,
  RbacSummary,
  runWeeklyGmReport,
  runEnterpriseSyntheticLoad,
  runIronmindWhatIf,
  requestWorkOrderApproval,
  saveOperatorEntry,
  subscribeIronmindStream,
  getSites,
  getSiteContext,
  grantSiteAccess,
  persistEnterpriseExportBundle,
  approveWorkOrder,
  createWorkOrderSlaRule,
  dispatchExecutiveShiftReportNow,
  generateExecutiveShiftReportPdf,
  getWorkOrderAttachments,
  getWorkOrderChecklist,
  getWorkOrderComments,
  getWorkOrderDependencies,
  getWorkOrderEscalations,
  updateWorkOrder,
  getWorkOrderSlaRules,
  getWorkOrderWorkflowBoard,
  removeWorkOrderDependency,
  retryWorkOrderEscalationsNow,
  runWorkOrderSlaEvaluation,
  uploadWorkOrderAttachment,
  addWorkOrderDependency,
  updateWorkOrderChecklistItemStatus,
  updateWorkOrderSlaRule,
  updateFaultRule
} from "./api";
import { SiteRouteControlPanel } from "./components/SiteRouteControlPanel";
import { TopKpiSummaryGrid } from "./components/TopKpiSummaryGrid";
import type { DashboardSection, RouteSection } from "./components/dashboardTypes";

type ModuleCard = {
  title: string;
  subtitle: string;
  data: Record<string, string | number>;
};

type ImportEntity = "assets" | "fuel" | "stores" | "hours";
type FaultChannel = "email" | "teams_webhook" | "whatsapp_webhook";
type OperatorEntryPayload = {
  entryDate: string;
  machineCode: string;
  shiftName: string;
  operatorName: string;
  hoursRun: number;
  hoursAvailable: number;
  fuelLiters?: number;
};

type LiveToast = {
  id: string;
  tone: "info" | "warning" | "danger";
  title: string;
  detail: string;
  createdAt: number;
};

const OFFLINE_QUEUE_KEY = "ironlog.operatorEntryQueue";

function formatLabel(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}

function parseDashboardHash(hash: string): { siteCode?: string; section?: DashboardSection } {
  const raw = hash.replace(/^#/, "").replace(/^\//, "");
  const parts = raw.split("/").filter((item) => item.length > 0);

  if (parts.length >= 3 && parts[0] === "site") {
    const section = parts[2] as DashboardSection;
    if (["overview", "ironmind", "departments", "enterprise", "admin"].includes(section)) {
      return { siteCode: parts[1].toUpperCase(), section };
    }
  }

  return {};
}

export function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
  const healthBaseUrl = apiBaseUrl.replace(/\/api\/?$/, "");

  const [email, setEmail] = useState("admin@ironlog.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [isAuthenticated, setIsAuthenticated] = useState(hasToken());
  const [plant, setPlant] = useState<PlantKpiResponse | null>(null);
  const [operations, setOperations] = useState<Record<string, unknown> | null>(null);
  const [cards, setCards] = useState<ModuleCard[]>([]);
  const [rbac, setRbac] = useState<RbacSummary | null>(null);
  const [auditItems, setAuditItems] = useState<RbacAuditItem[]>([]);
  const [rbacStatus, setRbacStatus] = useState<string>("");
  const [newUserEmail, setNewUserEmail] = useState("maintenance.manager@ironlog.local");
  const [newUserName, setNewUserName] = useState("Maintenance Manager");
  const [newUserPassword, setNewUserPassword] = useState("ChangeMe123!");
  const [newUserRoles, setNewUserRoles] = useState("manager");
  const [newRoleName, setNewRoleName] = useState("planner");
  const [newRolePermissions, setNewRolePermissions] = useState("plant.read,plant.write,operations.read");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserRoles, setSelectedUserRoles] = useState("viewer");
  const [selectedRoleId, setSelectedRoleId] = useState<number | "">("");
  const [selectedRolePermissions, setSelectedRolePermissions] = useState("plant.read,operations.read");
  const [assetsCsv, setAssetsCsv] = useState("assetCode,name,category,status,location\nEQ-1001,CAT 777D,truck,active,Pit A");
  const [fuelCsv, setFuelCsv] = useState("entryDate,machineCode,liters,unitCost,totalCost,sourceRef\n2026-04-01,EQ-1001,550,2.35,1292.5,TANKER-77");
  const [storesCsv, setStoresCsv] = useState("itemCode,name,unit,currentStock,reorderLevel,location\nFLT-001,Fuel Filter,pcs,45,20,Main Store");
  const [hoursCsv, setHoursCsv] = useState("entryDate,machineCode,shiftName,operatorName,hoursRun,hoursAvailable\n2026-04-01,EQ-1001,day,John Molefe,10.5,12");
  const [importStatus, setImportStatus] = useState("");
  const [parserLoadingEntity, setParserLoadingEntity] = useState<ImportEntity | null>(null);
  const [weeklyRuns, setWeeklyRuns] = useState<Array<Record<string, unknown>>>([]);
  const [faultRules, setFaultRules] = useState<Array<Record<string, unknown>>>([]);
  const [faultNotifications, setFaultNotifications] = useState<Array<Record<string, unknown>>>([]);
  const [ironmindOverview, setIronmindOverview] = useState<Record<string, unknown> | null>(null);
  const [ironmindTimeline, setIronmindTimeline] = useState<Array<Record<string, unknown>>>([]);
  const [ironmindRecommendations, setIronmindRecommendations] = useState<Array<Record<string, unknown>>>([]);
  const [predictiveRows, setPredictiveRows] = useState<Array<Record<string, unknown>>>([]);
  const [investigationCases, setInvestigationCases] = useState<Array<Record<string, unknown>>>([]);
  const [streamStatus, setStreamStatus] = useState("Realtime stream disconnected");
  const [streamEvents, setStreamEvents] = useState<Array<Record<string, unknown>>>([]);
  const [liveToasts, setLiveToasts] = useState<LiveToast[]>([]);
  const [criticalSoundEnabled, setCriticalSoundEnabled] = useState(true);
  const [alertMuteUntil, setAlertMuteUntil] = useState<number | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [deptDump, setDeptDump] = useState<{
    operations: Record<string, unknown> | null;
    hse: Record<string, unknown> | null;
    hr: Record<string, unknown> | null;
    quality: Record<string, unknown> | null;
    logistics: Record<string, unknown> | null;
  }>({
    operations: null,
    hse: null,
    hr: null,
    quality: null,
    logistics: null
  });
  const [enterpriseOverview, setEnterpriseOverview] = useState<Record<string, unknown> | null>(null);
  const [enterpriseTrends, setEnterpriseTrends] = useState<Record<string, unknown> | null>(null);
  const [siteContext, setSiteContext] = useState<Record<string, unknown> | null>(null);
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [enterpriseWindowHours, setEnterpriseWindowHours] = useState(24 * 7);
  const [enterpriseSiteCode, setEnterpriseSiteCode] = useState("SITE-A");
  const [syntheticDays, setSyntheticDays] = useState(21);
  const [syntheticMachinesCsv, setSyntheticMachinesCsv] = useState("EQ-1001,EQ-1002,EQ-1007,EQ-1010,EQ-1012,EQ-1014");
  const [syntheticEventsPerDay, setSyntheticEventsPerDay] = useState(5);
  const [syntheticCriticalSpike, setSyntheticCriticalSpike] = useState(true);
  const [syntheticScenarioTemplate, setSyntheticScenarioTemplate] = useState<"normal" | "stress" | "incident_surge">("normal");
  const [syntheticStatus, setSyntheticStatus] = useState("");
  const [syntheticRuns, setSyntheticRuns] = useState<Array<Record<string, unknown>>>([]);
  const [exportArtifacts, setExportArtifacts] = useState<Array<Record<string, unknown>>>([]);
  const [crossSiteComparison, setCrossSiteComparison] = useState<Array<Record<string, unknown>>>([]);
  const [workOrders, setWorkOrders] = useState<Array<Record<string, unknown>>>([]);
  const [workOrderBoard, setWorkOrderBoard] = useState<Record<string, unknown> | null>(null);
  const [workOrderAttribution, setWorkOrderAttribution] = useState<Record<string, unknown> | null>(null);
  const [workOrderScorecard, setWorkOrderScorecard] = useState<Record<string, unknown> | null>(null);
  const [workOrderStatus, setWorkOrderStatus] = useState("");
  const [workOrderSlaRules, setWorkOrderSlaRules] = useState<Array<Record<string, unknown>>>([]);
  const [workOrderEscalations, setWorkOrderEscalations] = useState<Array<Record<string, unknown>>>([]);
  const [workOrderAttachments, setWorkOrderAttachments] = useState<Array<Record<string, unknown>>>([]);
  const [workflowBoard, setWorkflowBoard] = useState<Record<string, unknown> | null>(null);
  const [workflowChecklistItems, setWorkflowChecklistItems] = useState<Array<Record<string, unknown>>>([]);
  const [workflowComments, setWorkflowComments] = useState<Array<Record<string, unknown>>>([]);
  const [workflowDependencies, setWorkflowDependencies] = useState<Array<Record<string, unknown>>>([]);
  const [newChecklistTitle, setNewChecklistTitle] = useState("Lockout and isolate equipment before hose replacement");
  const [newChecklistAssignee, setNewChecklistAssignee] = useState("Shift Artisan");
  const [newChecklistDueAt, setNewChecklistDueAt] = useState(new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [newWorkflowComment, setNewWorkflowComment] = useState("Waiting on stores confirmation for hydraulic seal kit.");
  const [newDependencyWorkOrderId, setNewDependencyWorkOrderId] = useState<number | "">("");
  const [slaRuleName, setSlaRuleName] = useState("Critical work order breach");
  const [slaRulePriority, setSlaRulePriority] = useState<"low" | "medium" | "high" | "critical">("critical");
  const [slaRuleDepartment, setSlaRuleDepartment] = useState("operations");
  const [slaRuleBreachHours, setSlaRuleBreachHours] = useState(6);
  const [slaRuleChannel, setSlaRuleChannel] = useState<"email" | "teams_webhook" | "whatsapp_webhook">("email");
  const [slaRuleRecipient, setSlaRuleRecipient] = useState("shift.control@ironlog.local");
  const [slaRuleAutoApproval, setSlaRuleAutoApproval] = useState(true);
  const [selectedSlaRuleId, setSelectedSlaRuleId] = useState<number | "">("");
  const [attachmentNotes, setAttachmentNotes] = useState("Pressure test result and photo evidence");
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [executiveReportStatus, setExecutiveReportStatus] = useState("");
  const [newWorkOrderDepartment, setNewWorkOrderDepartment] = useState("operations");
  const [newWorkOrderMachineCode, setNewWorkOrderMachineCode] = useState("EQ-1001");
  const [newWorkOrderFaultCode, setNewWorkOrderFaultCode] = useState("HYD-LEAK");
  const [newWorkOrderTitle, setNewWorkOrderTitle] = useState("Hydraulic hose replacement and pressure test");
  const [newWorkOrderDescription, setNewWorkOrderDescription] = useState("Recurring leak observed in shift handover. Replace assembly and verify under load.");
  const [newWorkOrderPriority, setNewWorkOrderPriority] = useState<"low" | "medium" | "high" | "critical">("high");
  const [newWorkOrderAssignedTo, setNewWorkOrderAssignedTo] = useState("Shift Foreman");
  const [newWorkOrderDueAt, setNewWorkOrderDueAt] = useState(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [newWorkOrderEstimatedCost, setNewWorkOrderEstimatedCost] = useState(18000);
  const [newWorkOrderDowntimeHours, setNewWorkOrderDowntimeHours] = useState(3);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<number | "">("");
  const [selectedWorkOrderStatus, setSelectedWorkOrderStatus] = useState<"open" | "assigned" | "in_progress" | "blocked" | "pending_approval" | "approved" | "closed">("assigned");
  const [selectedWorkOrderActualCost, setSelectedWorkOrderActualCost] = useState(12000);
  const [selectedWorkOrderDowntimeHours, setSelectedWorkOrderDowntimeHours] = useState(2);
  const [selectedWorkOrderEvidence, setSelectedWorkOrderEvidence] = useState("Replaced hose kit and validated pressure curve within range.");
  const [siteItems, setSiteItems] = useState<Array<Record<string, unknown>>>([]);
  const [newSiteCode, setNewSiteCode] = useState("SITE-D");
  const [newSiteName, setNewSiteName] = useState("Expansion Belt D");
  const [newSiteRegion, setNewSiteRegion] = useState("East Ridge");
  const [grantSiteId, setGrantSiteId] = useState<number | "">("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantRole, setGrantRole] = useState<"viewer" | "operator" | "manager" | "admin">("viewer");
  const [ironmindStatus, setIronmindStatus] = useState("");
  const [ironmindWindowHours, setIronmindWindowHours] = useState(24 * 7);
  const [predictiveHorizonHours, setPredictiveHorizonHours] = useState(72);
  const [predictiveWindowHours, setPredictiveWindowHours] = useState(24 * 14);
  const [timelineMachineFilter, setTimelineMachineFilter] = useState("EQ-1001");
  const [whatIfMachineCode, setWhatIfMachineCode] = useState("EQ-1001");
  const [whatIfFaultCode, setWhatIfFaultCode] = useState("HYD-LEAK");
  const [whatIfIncomingEvents, setWhatIfIncomingEvents] = useState(2);
  const [whatIfWindowHours, setWhatIfWindowHours] = useState(24);
  const [whatIfResult, setWhatIfResult] = useState<Record<string, unknown> | null>(null);
  const [newCaseMachineCode, setNewCaseMachineCode] = useState("EQ-1001");
  const [newCaseFaultCode, setNewCaseFaultCode] = useState("HYD-LEAK");
  const [newCaseSeverity, setNewCaseSeverity] = useState<"low" | "warning" | "high" | "critical">("warning");
  const [newCaseTitle, setNewCaseTitle] = useState("Hydraulic leak recurrence investigation");
  const [newCaseDescription, setNewCaseDescription] = useState("Recurring leak with rising severity. Validate hoses, pump pressure, and operator handling.");
  const [newCaseOwner, setNewCaseOwner] = useState("Maintenance Superintendent");
  const [selectedCaseId, setSelectedCaseId] = useState<number | "">("");
  const [caseActionTitle, setCaseActionTitle] = useState("Replace hose assembly and pressure test");
  const [caseActionOwner, setCaseActionOwner] = useState("Shift Foreman");
  const [caseActionDueAt, setCaseActionDueAt] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [caseActionNotes, setCaseActionNotes] = useState("Capture before/after pressure readings.");
  const [caseClosureSummary, setCaseClosureSummary] = useState("Root cause controlled and monitoring active.");
  const [automationStatus, setAutomationStatus] = useState("");
  const [newRuleName, setNewRuleName] = useState("Hydraulic repeat alert");
  const [newRuleThreshold, setNewRuleThreshold] = useState(3);
  const [newRuleWindowHours, setNewRuleWindowHours] = useState(24);
  const [newRuleChannel, setNewRuleChannel] = useState<FaultChannel>("email");
  const [newRuleRecipient, setNewRuleRecipient] = useState("maintenance.alerts@ironlog.local");
  const [selectedFaultRuleId, setSelectedFaultRuleId] = useState<number | "">("");
  const [editRuleName, setEditRuleName] = useState("Hydraulic repeat alert");
  const [editRuleThreshold, setEditRuleThreshold] = useState(3);
  const [editRuleWindowHours, setEditRuleWindowHours] = useState(24);
  const [editRuleChannel, setEditRuleChannel] = useState<FaultChannel>("email");
  const [editRuleRecipient, setEditRuleRecipient] = useState("maintenance.alerts@ironlog.local");
  const [editRuleEnabled, setEditRuleEnabled] = useState(true);
  const [faultMachineCode, setFaultMachineCode] = useState("EQ-1001");
  const [faultCode, setFaultCode] = useState("HYD-LEAK");
  const [faultSeverity, setFaultSeverity] = useState<"low" | "warning" | "high" | "critical">("warning");
  const [faultNotes, setFaultNotes] = useState("Hydraulic hose leak detected by operator");
  const [operatorDate, setOperatorDate] = useState(new Date().toISOString().slice(0, 10));
  const [operatorMachine, setOperatorMachine] = useState("EQ-1001");
  const [operatorShift, setOperatorShift] = useState("day");
  const [operatorName, setOperatorName] = useState("John Molefe");
  const [operatorHoursRun, setOperatorHoursRun] = useState(10.5);
  const [operatorHoursAvailable, setOperatorHoursAvailable] = useState(12);
  const [operatorFuelLiters, setOperatorFuelLiters] = useState(540);
  const [operatorRecent, setOperatorRecent] = useState<Array<Record<string, unknown>>>([]);
  const [operatorStatus, setOperatorStatus] = useState("");
  const [operatorQueue, setOperatorQueue] = useState<OperatorEntryPayload[]>(() => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OperatorEntryPayload[]) : [];
    } catch {
      return [];
    }
  });
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const onExpired = () => {
      setIsAuthenticated(false);
      setSessionExpiredMessage("Your session expired. Please sign in again.");
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    const applyHash = () => {
      const parsed = parseDashboardHash(window.location.hash);
      if (parsed.siteCode) {
        setEnterpriseSiteCode(parsed.siteCode);
      }
      if (parsed.section) {
        setActiveSection(parsed.section);
      }
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  function navigateToSection(section: DashboardSection, siteCode = enterpriseSiteCode) {
    window.location.hash = `/site/${siteCode.toUpperCase()}/${section}`;
  }

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    async function loadData() {
      try {
        setError("");
        const [plantKpis, ops, hse, hr, quality, logistics] = await Promise.all([
          getPlantKpis(),
          getOperationsDashboard(),
          getModuleSummary("hse"),
          getModuleSummary("hr"),
          getModuleSummary("quality"),
          getModuleSummary("logistics", "status")
        ]);

        setPlant(plantKpis);
        setOperations(ops);
        setCards([
          { title: "HSE", subtitle: "Health, Safety & Environment", data: hse },
          { title: "HR", subtitle: "People & Workforce", data: hr },
          { title: "Quality", subtitle: "Material & Compliance", data: quality },
          { title: "Logistics", subtitle: "Cargo & Supply Chain", data: logistics as Record<string, string | number> }
        ]);

        try {
          const [rbacData, audit, runs, rules, notifications, opRecent] = await Promise.all([
            getRbacSummary(),
            getRbacAudit(),
            getWeeklyGmRuns(),
            getFaultRules(),
            getFaultNotifications(),
            getOperatorEntries()
          ]);
          setRbac(rbacData);
          setAuditItems(audit.items);
          setWeeklyRuns(runs.items ?? []);
          setFaultRules(rules.items ?? []);
          setFaultNotifications(notifications.items ?? []);
          setOperatorRecent(opRecent.items ?? []);
          setRbacStatus("RBAC admin loaded.");

          const loadedRules = (rules.items ?? []) as Array<Record<string, unknown>>;
          if (loadedRules.length > 0 && selectedFaultRuleId === "") {
            setSelectedFaultRuleId(Number(loadedRules[0].id));
          }

          if (rbacData.users.length > 0 && !selectedUserId) {
            setSelectedUserId(rbacData.users[0].id);
          }

          if (rbacData.users.length > 0 && !grantUserId) {
            setGrantUserId(rbacData.users[0].id);
          }

          if (rbacData.roles.length > 0 && selectedRoleId === "") {
            setSelectedRoleId(rbacData.roles[0].id);
          }
        } catch {
          setRbac(null);
          setRbacStatus("Current user does not have system admin permission.");
        }

        try {
          await refreshIronmindIntel();
        } catch {
          setIronmindStatus("Ironmind tactical intel not available for this account.");
        }

        try {
          await refreshDepartmentDump();
        } catch {
          // Keep dashboard available even if dump endpoints are inaccessible.
        }

        try {
          await refreshEnterpriseOverview();
        } catch {
          setSyntheticStatus("Enterprise overview unavailable for current permissions.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    loadData();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStreamStatus("Realtime stream disconnected");
      return;
    }

    let closeStream: (() => void) | null = null;

    try {
      closeStream = subscribeIronmindStream((message) => {
        setStreamStatus("Realtime stream connected");
        setStreamEvents((prev) => [
          {
            type: message.type,
            payload: message.payload,
            receivedAt: new Date().toISOString()
          },
          ...prev
        ].slice(0, 20));

        if (message.type === "fault_event_created") {
          const severity = String(message.payload.severity ?? "warning");
          const tone: LiveToast["tone"] = severity === "critical" || severity === "high" ? "danger" : "warning";
          if (severity === "critical" || severity === "high") {
            playCriticalTone();
          }
          setLiveToasts((prev) => [
            {
              id: `${Date.now()}-fault-${Math.random().toString(16).slice(2, 7)}`,
              tone,
              title: `Fault ${String(message.payload.faultCode ?? "-")} on ${String(message.payload.machineCode ?? "-")}`,
              detail: `Severity: ${severity} | Alerts: ${String(message.payload.alertsTriggered ?? 0)}`,
              createdAt: Date.now()
            },
            ...prev
          ].slice(0, 6));
        }

        if (message.type === "investigation_case_updated") {
          const status = String(message.payload.status ?? "open");
          const tone: LiveToast["tone"] = status === "closed" ? "info" : "warning";
          setLiveToasts((prev) => [
            {
              id: `${Date.now()}-case-${Math.random().toString(16).slice(2, 7)}`,
              tone,
              title: `Case ${String(message.payload.caseCode ?? "-")} ${status}`,
              detail: `${String(message.payload.machineCode ?? "-")} / ${String(message.payload.faultCode ?? "-")}`,
              createdAt: Date.now()
            },
            ...prev
          ].slice(0, 6));
        }

        if (message.type === "fault_event_created" || message.type === "investigation_case_updated") {
          void refreshIronmindIntel();
        }
      });
    } catch (err) {
      setStreamStatus(err instanceof Error ? err.message : "Failed to connect realtime stream");
    }

    return () => {
      if (closeStream) {
        closeStream();
      }
      setStreamStatus("Realtime stream disconnected");
    };
  }, [isAuthenticated, criticalSoundEnabled, alertMuteUntil, audioContext]);

  useEffect(() => {
    if (liveToasts.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const cutoff = Date.now() - 8000;
      setLiveToasts((prev) => prev.filter((item) => item.createdAt >= cutoff));
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [liveToasts]);

  function playCriticalTone() {
    if (!criticalSoundEnabled) {
      return;
    }
    if (alertMuteUntil && alertMuteUntil > Date.now()) {
      return;
    }

    try {
      const ctx = audioContext ?? new window.AudioContext();
      if (!audioContext) {
        setAudioContext(ctx);
      }

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(760, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.33);
    } catch {
      // Non-blocking UX enhancement only.
    }
  }

  function acknowledgeToast(id: string) {
    setLiveToasts((prev) => prev.filter((item) => item.id !== id));
  }

  function muteAlerts(minutes: number) {
    setAlertMuteUntil(Date.now() + minutes * 60 * 1000);
  }

  async function refreshDepartmentDump() {
    const [operationsDump, hseDump, hrDump, qualityDump, logisticsDump] = await Promise.all([
      getOperationsDump(),
      getHseDump(),
      getHrDump(),
      getQualityDump(),
      getLogisticsDump()
    ]);

    setDeptDump({
      operations: operationsDump,
      hse: hseDump,
      hr: hrDump,
      quality: qualityDump,
      logistics: logisticsDump
    });
  }

  async function refreshWorkOrderExecution(siteCode = enterpriseSiteCode) {
    const [orders, board, attribution, scorecard, rules, escalations, workflow] = await Promise.all([
      getWorkOrders(siteCode),
      getWorkOrderShiftBoard(siteCode),
      getWorkOrderAttribution(siteCode, enterpriseWindowHours),
      getWorkOrderScorecard(siteCode, 30),
      getWorkOrderSlaRules(siteCode),
      getWorkOrderEscalations(siteCode),
      getWorkOrderWorkflowBoard(siteCode)
    ]);

    const nextOrders = (orders.items ?? []) as Array<Record<string, unknown>>;
    setWorkOrders(nextOrders);
    setWorkOrderBoard(board as Record<string, unknown>);
    setWorkOrderAttribution(attribution as Record<string, unknown>);
    setWorkOrderScorecard(scorecard as Record<string, unknown>);
    setWorkOrderSlaRules((rules.items ?? []) as Array<Record<string, unknown>>);
    setWorkOrderEscalations((escalations.items ?? []) as Array<Record<string, unknown>>);
    setWorkflowBoard(workflow as Record<string, unknown>);

    if (nextOrders.length > 0 && selectedWorkOrderId === "") {
      setSelectedWorkOrderId(Number(nextOrders[0].id));
    }

    const ruleItems = (rules.items ?? []) as Array<Record<string, unknown>>;
    if (ruleItems.length > 0 && selectedSlaRuleId === "") {
      setSelectedSlaRuleId(Number(ruleItems[0].id));
    }

    if (nextOrders.length > 0 && newDependencyWorkOrderId === "") {
      const candidate = nextOrders.find((item) => Number(item.id) !== Number(selectedWorkOrderId));
      if (candidate) {
        setNewDependencyWorkOrderId(Number(candidate.id));
      }
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  async function refreshSelectedWorkOrderAttachments() {
    if (selectedWorkOrderId === "") {
      setWorkOrderAttachments([]);
      return;
    }

    const attachments = await getWorkOrderAttachments(Number(selectedWorkOrderId));
    setWorkOrderAttachments((attachments.items ?? []) as Array<Record<string, unknown>>);
  }

  async function refreshSelectedWorkflowItems() {
    if (selectedWorkOrderId === "") {
      setWorkflowChecklistItems([]);
      setWorkflowComments([]);
      setWorkflowDependencies([]);
      return;
    }

    const [checklist, comments, dependencies] = await Promise.all([
      getWorkOrderChecklist(Number(selectedWorkOrderId)),
      getWorkOrderComments(Number(selectedWorkOrderId), 120),
      getWorkOrderDependencies(Number(selectedWorkOrderId))
    ]);

    setWorkflowChecklistItems((checklist.items ?? []) as Array<Record<string, unknown>>);
    setWorkflowComments((comments.items ?? []) as Array<Record<string, unknown>>);
    setWorkflowDependencies((dependencies.items ?? []) as Array<Record<string, unknown>>);
  }

  async function refreshEnterpriseOverview(hours = enterpriseWindowHours, siteCode = enterpriseSiteCode) {
    const overview = await getEnterpriseOverviewBySite(hours, siteCode);
    setEnterpriseOverview(overview as Record<string, unknown>);

    const [runs, artifacts, trends, sites, comparison, context] = await Promise.all([
      getEnterpriseSyntheticLoadRunsBySite(siteCode),
      getEnterpriseExportArtifacts(siteCode),
      getEnterpriseTrends(hours, siteCode, 24),
      getSites(),
      getCrossSiteComparison(hours),
      getSiteContext(siteCode)
    ]);
    setSyntheticRuns((runs.items ?? []) as Array<Record<string, unknown>>);
    setExportArtifacts((artifacts.items ?? []) as Array<Record<string, unknown>>);
    setEnterpriseTrends(trends as Record<string, unknown>);
    setSiteItems((sites.items ?? []) as Array<Record<string, unknown>>);
    setCrossSiteComparison((comparison.items ?? []) as Array<Record<string, unknown>>);
    setSiteContext(context as Record<string, unknown>);
    await refreshWorkOrderExecution(siteCode);
  }

  async function onCreateWorkOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await createWorkOrder({
        siteCode: enterpriseSiteCode,
        department: newWorkOrderDepartment,
        machineCode: newWorkOrderMachineCode,
        faultCode: newWorkOrderFaultCode,
        title: newWorkOrderTitle,
        description: newWorkOrderDescription,
        priority: newWorkOrderPriority,
        assignedToName: newWorkOrderAssignedTo,
        dueAt: newWorkOrderDueAt ? new Date(newWorkOrderDueAt).toISOString() : undefined,
        estimatedCost: newWorkOrderEstimatedCost,
        downtimeHours: newWorkOrderDowntimeHours
      });

      setWorkOrderStatus(`Work order opened: ${String(created.workOrderCode ?? "n/a")}`);
      await refreshWorkOrderExecution();
      await refreshSelectedWorkflowItems();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to create work order");
    }
  }

  async function onUpdateWorkOrderState(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await updateWorkOrder(Number(selectedWorkOrderId), {
        status: selectedWorkOrderStatus
      });
      setWorkOrderStatus(`Work order ${selectedWorkOrderId} updated to ${selectedWorkOrderStatus}.`);
      await refreshWorkOrderExecution();
      await refreshSelectedWorkflowItems();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to update work order");
    }
  }

  async function onRequestSelectedWorkOrderApproval() {
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await requestWorkOrderApproval(Number(selectedWorkOrderId), "Supervisor approval requested from command board");
      setWorkOrderStatus(`Approval requested for work order ${selectedWorkOrderId}.`);
      await refreshWorkOrderExecution();
      await refreshSelectedWorkflowItems();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to request approval");
    }
  }

  async function onApproveSelectedWorkOrder() {
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await approveWorkOrder(Number(selectedWorkOrderId), "Approved from execution control panel");
      setWorkOrderStatus(`Work order ${selectedWorkOrderId} approved.`);
      await refreshWorkOrderExecution();
      await refreshSelectedWorkflowItems();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to approve work order");
    }
  }

  async function onCloseSelectedWorkOrder() {
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await closeWorkOrder(Number(selectedWorkOrderId), {
        actualCost: selectedWorkOrderActualCost,
        downtimeHours: selectedWorkOrderDowntimeHours,
        evidenceNotes: selectedWorkOrderEvidence
      });
      setWorkOrderStatus(`Work order ${selectedWorkOrderId} closed.`);
      await refreshWorkOrderExecution();
      await refreshSelectedWorkOrderAttachments();
      await refreshSelectedWorkflowItems();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to close work order");
    }
  }

  async function onAddChecklistItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await createWorkOrderChecklistItem(Number(selectedWorkOrderId), {
        title: newChecklistTitle,
        assigneeName: newChecklistAssignee,
        dueAt: newChecklistDueAt ? new Date(newChecklistDueAt).toISOString() : undefined
      });
      setWorkOrderStatus(`Checklist item added to work order ${selectedWorkOrderId}.`);
      await Promise.all([refreshWorkOrderExecution(), refreshSelectedWorkflowItems()]);
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to add checklist item");
    }
  }

  async function onToggleChecklistItem(itemId: number, nextStatus: "todo" | "done") {
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await updateWorkOrderChecklistItemStatus(Number(selectedWorkOrderId), itemId, nextStatus);
      await Promise.all([refreshWorkOrderExecution(), refreshSelectedWorkflowItems()]);
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to update checklist item");
    }
  }

  async function onAddWorkflowComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await createWorkOrderComment(Number(selectedWorkOrderId), newWorkflowComment);
      setWorkOrderStatus(`Comment added to work order ${selectedWorkOrderId}.`);
      await Promise.all([refreshWorkOrderExecution(), refreshSelectedWorkflowItems()]);
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to add comment");
    }
  }

  async function onAddDependency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }
    if (newDependencyWorkOrderId === "") {
      setWorkOrderStatus("Select a dependency work order.");
      return;
    }

    try {
      await addWorkOrderDependency(Number(selectedWorkOrderId), Number(newDependencyWorkOrderId));
      setWorkOrderStatus(`Dependency added to work order ${selectedWorkOrderId}.`);
      await Promise.all([refreshWorkOrderExecution(), refreshSelectedWorkflowItems()]);
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to add dependency");
    }
  }

  async function onRemoveDependency(dependsOnId: number) {
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      await removeWorkOrderDependency(Number(selectedWorkOrderId), dependsOnId);
      await Promise.all([refreshWorkOrderExecution(), refreshSelectedWorkflowItems()]);
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to remove dependency");
    }
  }

  async function onCreateSlaRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await createWorkOrderSlaRule({
        siteCode: enterpriseSiteCode,
        name: slaRuleName,
        enabled: true,
        appliesPriority: slaRulePriority,
        appliesDepartment: slaRuleDepartment,
        breachAfterHours: slaRuleBreachHours,
        escalationChannel: slaRuleChannel,
        escalationRecipient: slaRuleRecipient,
        autoRequestApproval: slaRuleAutoApproval
      });

      setWorkOrderStatus(`SLA rule saved: ${String(created.name ?? "-")}`);
      await refreshWorkOrderExecution();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to save SLA rule");
    }
  }

  async function onToggleSelectedSlaRule(enabled: boolean) {
    if (selectedSlaRuleId === "") {
      setWorkOrderStatus("Select an SLA rule first.");
      return;
    }

    try {
      await updateWorkOrderSlaRule(Number(selectedSlaRuleId), { enabled });
      setWorkOrderStatus(`SLA rule ${selectedSlaRuleId} ${enabled ? "enabled" : "disabled"}.`);
      await refreshWorkOrderExecution();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Failed to update SLA rule");
    }
  }

  async function onRunSlaEvaluationNow() {
    try {
      const result = await runWorkOrderSlaEvaluation(enterpriseSiteCode);
      setWorkOrderStatus(`SLA evaluation done: escalations ${String(result.escalationsTriggered ?? 0)}.`);
      await refreshWorkOrderExecution();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "SLA evaluation failed");
    }
  }

  async function onUploadAttachment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }
    if (!selectedAttachmentFile) {
      setWorkOrderStatus("Select a file to upload.");
      return;
    }

    try {
      const base64 = await fileToBase64(selectedAttachmentFile);
      await uploadWorkOrderAttachment(Number(selectedWorkOrderId), {
        fileName: selectedAttachmentFile.name,
        mimeType: selectedAttachmentFile.type || "application/octet-stream",
        contentBase64: base64,
        notes: attachmentNotes
      });
      setWorkOrderStatus(`Attachment uploaded to work order ${selectedWorkOrderId}.`);
      setSelectedAttachmentFile(null);
      await refreshSelectedWorkOrderAttachments();
      await refreshWorkOrderExecution();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Attachment upload failed");
    }
  }

  async function onDownloadWorkOrderAttachment(attachmentId: number, fileName: string) {
    if (selectedWorkOrderId === "") {
      setWorkOrderStatus("Select a work order first.");
      return;
    }

    try {
      const apiOrigin = apiBaseUrl.replace(/\/api\/?$/, "");
      const token = localStorage.getItem("ironlog.token");
      const url = `${apiOrigin}/api/work-orders/${selectedWorkOrderId}/attachments/${attachmentId}/download`;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Attachment download failed");
    }
  }

  async function onGenerateExecutiveReport() {
    try {
      const result = await generateExecutiveShiftReportPdf(enterpriseSiteCode);
      const apiOrigin = apiBaseUrl.replace(/\/api\/?$/, "");
      const fullUrl = `${apiOrigin}${String(result.downloadUrl ?? "")}`;
      setExecutiveReportStatus(`Executive report generated: ${String(result.fileName ?? "report.pdf")}`);
      await navigator.clipboard.writeText(fullUrl);
      setExecutiveReportStatus((prev) => `${prev} | link copied`);
      await refreshWorkOrderExecution();
    } catch (err) {
      setExecutiveReportStatus(err instanceof Error ? err.message : "Failed to generate executive report");
    }
  }

  async function onRetryEscalationsNow() {
    try {
      const result = await retryWorkOrderEscalationsNow();
      setWorkOrderStatus(
        `Escalation retry run complete: retried ${String(result.retried ?? 0)}, sent ${String(result.sent ?? 0)}, failed ${String(result.failed ?? 0)}.`
      );
      await refreshWorkOrderExecution();
    } catch (err) {
      setWorkOrderStatus(err instanceof Error ? err.message : "Escalation retry failed");
    }
  }

  async function onDispatchExecutiveReportNow() {
    try {
      const result = await dispatchExecutiveShiftReportNow();
      const recipients = ((result.recipients ?? []) as Array<Record<string, unknown>>).length;
      setExecutiveReportStatus(`Executive dispatch complete: recipients ${recipients}.`);
      await refreshWorkOrderExecution();
    } catch (err) {
      setExecutiveReportStatus(err instanceof Error ? err.message : "Executive dispatch failed");
    }
  }

  async function onRunSyntheticLoad(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const machines = syntheticMachinesCsv
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      const result = await runEnterpriseSyntheticLoad({
        days: syntheticDays,
        machines,
        eventsPerDayPerMachine: syntheticEventsPerDay,
        includeCriticalSpike: syntheticCriticalSpike,
        siteCode: enterpriseSiteCode,
        scenarioTemplate: syntheticScenarioTemplate
      });

      setSyntheticStatus(
        `Synthetic load complete: faults ${String(result.inserted?.faultEvents ?? 0)}, fuel ${String(result.inserted?.fuelRows ?? 0)}, hours ${String(result.inserted?.hoursRows ?? 0)}`
      );

      await Promise.all([refreshIronmindIntel(), refreshDepartmentDump(), refreshEnterpriseOverview()]);
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Synthetic generation failed");
    }
  }

  async function onDownloadEnterpriseBundle() {
    try {
      const bundle = await getEnterpriseExportBundle(enterpriseWindowHours, enterpriseSiteCode);
      const fileName = `ironlog-enterprise-bundle-${enterpriseSiteCode}-${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setSyntheticStatus(`Export bundle downloaded: ${fileName}`);
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Failed to download export bundle");
    }
  }

  async function onPersistEnterpriseBundle() {
    try {
      const artifact = await persistEnterpriseExportBundle(enterpriseWindowHours, enterpriseSiteCode);
      setSyntheticStatus(`Export artifact saved: ${String(artifact.fileName ?? "n/a")}`);
      await refreshEnterpriseOverview();
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Failed to persist export artifact");
    }
  }

  async function onDownloadArtifact(artifactId: number, fileName: string) {
    try {
      const apiOrigin = apiBaseUrl.replace(/\/api\/?$/, "");
      const token = localStorage.getItem("ironlog.token");
      const url = `${apiOrigin}/api/enterprise/export-artifacts/${artifactId}/download`;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Artifact download failed");
    }
  }

  async function onCreateArtifactToken(artifactId: number) {
    try {
      const token = await createEnterpriseArtifactToken(artifactId);
      const fullUrl = `${window.location.origin}${String(token.downloadUrl ?? "")}`;
      await navigator.clipboard.writeText(fullUrl);
      setSyntheticStatus(`One-time download link copied to clipboard (expires ${String(token.expiresAt ?? "soon")}).`);
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Failed to create artifact token");
    }
  }

  async function onCreateSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createSite({
        siteCode: newSiteCode,
        name: newSiteName,
        region: newSiteRegion,
        isActive: true
      });

      const sites = await getSites();
      setSiteItems((sites.items ?? []) as Array<Record<string, unknown>>);
      setSyntheticStatus("Site saved.");
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Failed to create site");
    }
  }

  async function onGrantSiteAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (grantSiteId === "") {
      setSyntheticStatus("Select site for access grant.");
      return;
    }

    if (!grantUserId) {
      setSyntheticStatus("Select user for site access grant.");
      return;
    }

    try {
      await grantSiteAccess(grantSiteId, {
        userId: grantUserId,
        role: grantRole
      });
      setSyntheticStatus("Site access granted.");
    } catch (err) {
      setSyntheticStatus(err instanceof Error ? err.message : "Failed to grant site access");
    }
  }

  async function refreshIronmindIntel(nextWindowHours = ironmindWindowHours, nextMachineFilter = timelineMachineFilter) {
    const machineFilter = nextMachineFilter.trim();
    const [overview, timeline, recommendations, predictive, cases] = await Promise.all([
      getIronmindIntelOverview(nextWindowHours),
      getIronmindIntelTimeline(machineFilter.length > 0 ? machineFilter : undefined, 80),
      getIronmindRecommendations(nextWindowHours),
      getIronmindPredictive(predictiveHorizonHours, predictiveWindowHours),
      getInvestigationCases(80)
    ]);

    setIronmindOverview(overview as Record<string, unknown>);
    setIronmindTimeline((timeline.timeline ?? []) as Array<Record<string, unknown>>);
    setIronmindRecommendations((recommendations.recommendations ?? []) as Array<Record<string, unknown>>);
    setPredictiveRows((predictive.machines ?? []) as Array<Record<string, unknown>>);
    const loadedCases = (cases.items ?? []) as Array<Record<string, unknown>>;
    setInvestigationCases(loadedCases);
    if (loadedCases.length > 0 && selectedCaseId === "") {
      setSelectedCaseId(Number(loadedCases[0].id));
    }
    setIronmindStatus(`Intel refreshed for ${nextWindowHours}h window.`);
  }

  useEffect(() => {
    if (selectedFaultRuleId === "") {
      return;
    }

    const rule = faultRules.find((item) => Number(item.id) === selectedFaultRuleId);
    if (!rule) {
      return;
    }

    setEditRuleName(String(rule.name ?? ""));
    setEditRuleThreshold(Number(rule.occurrenceThreshold ?? 3));
    setEditRuleWindowHours(Number(rule.windowHours ?? 24));

    const channel = String(rule.channel ?? "email");
    if (channel === "teams_webhook" || channel === "whatsapp_webhook" || channel === "email") {
      setEditRuleChannel(channel);
    }

    setEditRuleRecipient(String(rule.recipient ?? ""));
    setEditRuleEnabled(Boolean(rule.enabled));
  }, [selectedFaultRuleId, faultRules]);

  useEffect(() => {
    if (selectedWorkOrderId === "") {
      return;
    }

    const item = workOrders.find((row) => Number(row.id) === Number(selectedWorkOrderId));
    if (!item) {
      return;
    }

    const status = String(item.status ?? "assigned");
    if (["open", "assigned", "in_progress", "blocked", "pending_approval", "approved", "closed"].includes(status)) {
      setSelectedWorkOrderStatus(status as "open" | "assigned" | "in_progress" | "blocked" | "pending_approval" | "approved" | "closed");
    }

    setSelectedWorkOrderActualCost(Number(item.actualCost ?? 0));
    setSelectedWorkOrderDowntimeHours(Number(item.downtimeHours ?? 0));
    setSelectedWorkOrderEvidence(String(item.evidenceNotes ?? ""));
    void refreshSelectedWorkOrderAttachments();
    void refreshSelectedWorkflowItems();
  }, [selectedWorkOrderId, workOrders]);

  useEffect(() => {
    if (!selectedAttachmentFile) {
      setAttachmentPreviewUrl(null);
      return;
    }

    if (!selectedAttachmentFile.type.startsWith("image/")) {
      setAttachmentPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedAttachmentFile);
    setAttachmentPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedAttachmentFile]);

  async function onLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await login(email, password);
      setIsAuthenticated(true);
      setSessionExpiredMessage("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to login");
    }
  }

  function parseList(text: string) {
    return text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  function persistOperatorQueue(queue: OperatorEntryPayload[]) {
    setOperatorQueue(queue);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  }

  async function syncQueuedOperatorEntries() {
    if (operatorQueue.length === 0) {
      return;
    }

    const remaining: OperatorEntryPayload[] = [];

    for (const item of operatorQueue) {
      try {
        await saveOperatorEntry(item);
      } catch {
        remaining.push(item);
      }
    }

    persistOperatorQueue(remaining);

    if (remaining.length === 0) {
      const recents = await getOperatorEntries();
      setOperatorRecent(recents.items ?? []);
      setOperatorStatus("Offline queue synced successfully.");
    } else {
      setOperatorStatus(`Synced with pending items: ${remaining.length}`);
    }
  }

  useEffect(() => {
    const onOnline = () => {
      void syncQueuedOperatorEntries();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [operatorQueue]);

  async function refreshRbac() {
    const [data, audit, runs, rules, notifications, opRecent] = await Promise.all([
      getRbacSummary(),
      getRbacAudit(),
      getWeeklyGmRuns(),
      getFaultRules(),
      getFaultNotifications(),
      getOperatorEntries()
    ]);
    setRbac(data);
    setAuditItems(audit.items);
    setWeeklyRuns(runs.items ?? []);
    setFaultRules(rules.items ?? []);
    setFaultNotifications(notifications.items ?? []);
    setOperatorRecent(opRecent.items ?? []);

    const loadedRules = (rules.items ?? []) as Array<Record<string, unknown>>;
    if (loadedRules.length > 0 && selectedFaultRuleId === "") {
      setSelectedFaultRuleId(Number(loadedRules[0].id));
    }

    try {
      await refreshIronmindIntel();
    } catch {
      // Keep admin workflows responsive even if intel permissions/data are unavailable.
    }
  }

  async function onRunWeeklyReport() {
    try {
      const result = await runWeeklyGmReport();
      await refreshRbac();
      setAutomationStatus(`Weekly GM report created: ${(result.report?.fileName as string) ?? "n/a"}`);
    } catch (err) {
      setAutomationStatus(err instanceof Error ? err.message : "Failed to run report");
    }
  }

  async function onCreateFaultRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createFaultRule({
        name: newRuleName,
        enabled: true,
        occurrenceThreshold: newRuleThreshold,
        windowHours: newRuleWindowHours,
        channel: newRuleChannel,
        recipient: newRuleRecipient
      });
      await refreshRbac();
      setAutomationStatus("Fault notification rule created.");
    } catch (err) {
      setAutomationStatus(err instanceof Error ? err.message : "Failed to create rule");
    }
  }

  async function onSubmitFaultEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await createFaultEvent({
        machineCode: faultMachineCode,
        faultCode,
        severity: faultSeverity,
        notes: faultNotes
      });
      await refreshRbac();
      setAutomationStatus(`Fault event saved. Alerts triggered: ${String(result.alertsTriggered ?? 0)}`);
    } catch (err) {
      setAutomationStatus(err instanceof Error ? err.message : "Failed to submit fault event");
    }
  }

  async function onSubmitOperatorEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: OperatorEntryPayload = {
      entryDate: operatorDate,
      machineCode: operatorMachine,
      shiftName: operatorShift,
      operatorName,
      hoursRun: operatorHoursRun,
      hoursAvailable: operatorHoursAvailable,
      fuelLiters: operatorFuelLiters
    };

    try {
      await saveOperatorEntry(payload);
      const recents = await getOperatorEntries();
      setOperatorRecent(recents.items ?? []);
      setOperatorStatus("Operator entry saved.");
    } catch (err) {
      const nextQueue = [...operatorQueue, payload];
      persistOperatorQueue(nextQueue);
      setOperatorStatus(`No network/API. Entry queued offline (${nextQueue.length} pending).`);
    }
  }

  async function onUpdateFaultRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFaultRuleId === "") {
      setAutomationStatus("Select a fault rule to update.");
      return;
    }

    try {
      await updateFaultRule(selectedFaultRuleId, {
        name: editRuleName,
        enabled: editRuleEnabled,
        occurrenceThreshold: editRuleThreshold,
        windowHours: editRuleWindowHours,
        channel: editRuleChannel,
        recipient: editRuleRecipient
      });
      await refreshRbac();
      setAutomationStatus("Fault rule updated.");
    } catch (err) {
      setAutomationStatus(err instanceof Error ? err.message : "Failed to update rule");
    }
  }

  async function onDisableFaultRule() {
    if (selectedFaultRuleId === "") {
      setAutomationStatus("Select a fault rule to disable.");
      return;
    }

    try {
      await disableFaultRule(selectedFaultRuleId);
      await refreshRbac();
      setAutomationStatus("Fault rule disabled.");
    } catch (err) {
      setAutomationStatus(err instanceof Error ? err.message : "Failed to disable rule");
    }
  }

  async function onDeleteFaultRule() {
    if (selectedFaultRuleId === "") {
      setAutomationStatus("Select a fault rule to delete.");
      return;
    }

    try {
      await deleteFaultRule(selectedFaultRuleId);
      setSelectedFaultRuleId("");
      await refreshRbac();
      setAutomationStatus("Fault rule deleted.");
    } catch (err) {
      setAutomationStatus(err instanceof Error ? err.message : "Failed to delete rule");
    }
  }

  async function onRefreshIronmindIntel() {
    try {
      await refreshIronmindIntel(ironmindWindowHours, timelineMachineFilter);
    } catch (err) {
      setIronmindStatus(err instanceof Error ? err.message : "Failed to refresh tactical intel");
    }
  }

  async function onRunWhatIf(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await runIronmindWhatIf({
        machineCode: whatIfMachineCode,
        faultCode: whatIfFaultCode,
        incomingEvents: whatIfIncomingEvents,
        windowHours: whatIfWindowHours
      });
      setWhatIfResult(result as Record<string, unknown>);
      setIronmindStatus("What-if simulation completed.");
    } catch (err) {
      setIronmindStatus(err instanceof Error ? err.message : "Failed to run what-if simulation");
    }
  }

  async function onCreateInvestigationCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await createInvestigationCase({
        machineCode: newCaseMachineCode,
        faultCode: newCaseFaultCode,
        severity: newCaseSeverity,
        title: newCaseTitle,
        description: newCaseDescription,
        ownerName: newCaseOwner
      });

      setSelectedCaseId(Number(created.id));
      await refreshIronmindIntel();
      setIronmindStatus(`Investigation case ${String(created.caseCode ?? "created")} opened.`);
    } catch (err) {
      setIronmindStatus(err instanceof Error ? err.message : "Failed to create investigation case");
    }
  }

  async function onAddCaseAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedCaseId === "") {
      setIronmindStatus("Select a case before adding actions.");
      return;
    }

    try {
      await addCaseAction(selectedCaseId, {
        actionTitle: caseActionTitle,
        ownerName: caseActionOwner,
        dueAt: caseActionDueAt ? new Date(caseActionDueAt).toISOString() : undefined,
        notes: caseActionNotes
      });

      await refreshIronmindIntel();
      setIronmindStatus("Investigation action added.");
    } catch (err) {
      setIronmindStatus(err instanceof Error ? err.message : "Failed to add investigation action");
    }
  }

  async function onCloseCase() {
    if (selectedCaseId === "") {
      setIronmindStatus("Select a case before closing it.");
      return;
    }

    try {
      await closeInvestigationCase(selectedCaseId, caseClosureSummary);
      await refreshIronmindIntel();
      setIronmindStatus("Investigation case closed.");
    } catch (err) {
      setIronmindStatus(err instanceof Error ? err.message : "Failed to close investigation case");
    }
  }

  function openHealth(path: "/health" | "/health/startup" | "/health/ui") {
    window.open(`${healthBaseUrl}${path}`, "_blank", "noopener,noreferrer");
  }

  async function onCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createRbacUser({
        email: newUserEmail,
        fullName: newUserName,
        password: newUserPassword,
        roleNames: parseList(newUserRoles)
      });
      await refreshRbac();
      setRbacStatus("User created or updated successfully.");
    } catch (err) {
      setRbacStatus(err instanceof Error ? err.message : "Failed to create user.");
    }
  }

  async function onCreateRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createRbacRole({
        name: newRoleName,
        permissionNames: parseList(newRolePermissions)
      });
      await refreshRbac();
      setRbacStatus("Role created or updated successfully.");
    } catch (err) {
      setRbacStatus(err instanceof Error ? err.message : "Failed to create role.");
    }
  }

  async function onAssignUserRoles(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId) {
      setRbacStatus("Select a user first.");
      return;
    }

    try {
      await assignUserRoles(selectedUserId, parseList(selectedUserRoles));
      await refreshRbac();
      setRbacStatus("User roles updated.");
    } catch (err) {
      setRbacStatus(err instanceof Error ? err.message : "Failed to assign roles.");
    }
  }

  async function onAssignRolePermissions(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedRoleId === "") {
      setRbacStatus("Select a role first.");
      return;
    }

    try {
      await assignRolePermissions(selectedRoleId, parseList(selectedRolePermissions));
      await refreshRbac();
      setRbacStatus("Role permissions updated.");
    } catch (err) {
      setRbacStatus(err instanceof Error ? err.message : "Failed to assign permissions.");
    }
  }

  async function handleImport(entity: "assets" | "fuel" | "stores" | "hours", csv: string) {
    try {
      const result = await importCsv(entity, csv);
      await refreshRbac();
      setImportStatus(`${entity.toUpperCase()} import complete: ${result.imported} rows`);
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "Import failed");
    }
  }

  async function extractRowsFromFile(file: File) {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".csv")) {
      const text = await file.text();
      const rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      if (rows.length < 2) {
        return [] as Array<Record<string, unknown>>;
      }

      const headers = rows[0].split(",").map((col) => col.trim());

      return rows.slice(1).map((line) => {
        const values = line.split(",").map((val) => val.trim());
        const row: Record<string, unknown> = {};

        for (let idx = 0; idx < headers.length; idx += 1) {
          row[headers[idx]] = values[idx] ?? "";
        }

        return row;
      });
    }

    const XLSX = await import("xlsx");
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return [] as Array<Record<string, unknown>>;
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: ""
    });

    return rows;
  }

  async function handleFileImport(entity: ImportEntity, file: File) {
    try {
      setParserLoadingEntity(entity);
      setImportStatus(`Preparing ${file.name} for import...`);
      const rows = await extractRowsFromFile(file);
      if (rows.length === 0) {
        setImportStatus(`No rows found in ${file.name}`);
        setParserLoadingEntity(null);
        return;
      }

      const result = await importRows(entity, rows);
      await refreshRbac();
      setImportStatus(`${entity.toUpperCase()} file import complete: ${result.imported} rows from ${file.name}`);
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "File import failed");
    } finally {
      setParserLoadingEntity(null);
    }
  }

  function onDropFile(entity: ImportEntity, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }
    void handleFileImport(entity, file);
  }

  function onFileChange(entity: ImportEntity, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    void handleFileImport(entity, file);
    event.currentTarget.value = "";
  }

  const utilizationAvg = useMemo(() => {
    if (!plant) {
      return 0;
    }
    const total = plant.availability.reduce((sum, row) => sum + row.utilization, 0);
    return Number((total / Math.max(1, plant.availability.length)).toFixed(2));
  }, [plant]);

  const ironmindTopFaults = ((ironmindOverview?.topFaults as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 6);
  const ironmindHotMachines = ((ironmindOverview?.hotMachines as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 6);
  const ironmindChannelHealth = ((ironmindOverview?.channelHealth as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 6);
  const operationsFleet = ((deptDump.operations?.fleetPerformance as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10);
  const hseIncidents = ((deptDump.hse?.incidents as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10);
  const hrTrainingExpiring = ((deptDump.hr?.trainingExpiring as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10);
  const qualityLabResults = ((deptDump.quality?.labResults as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10);
  const logisticsTrips = ((deptDump.logistics?.trips as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10);
  const recentFaultKeys = new Set(
    streamEvents
      .filter((event) => event.type === "fault_event_created")
      .slice(0, 8)
      .map((event) => `${String((event.payload as Record<string, unknown>)?.machineCode ?? "")}:${String((event.payload as Record<string, unknown>)?.faultCode ?? "")}`)
  );
  const recentCaseIds = new Set(
    streamEvents
      .filter((event) => event.type === "investigation_case_updated")
      .slice(0, 8)
      .map((event) => Number((event.payload as Record<string, unknown>)?.caseId))
      .filter((value) => Number.isFinite(value))
  );
  const machineRealtimeCounters = useMemo(() => {
    const map = new Map<string, { events: number; critical: number }>();
    for (const event of streamEvents) {
      if (event.type !== "fault_event_created") {
        continue;
      }
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const machineCode = String(payload.machineCode ?? "UNKNOWN");
      const severity = String(payload.severity ?? "warning");
      const bucket = map.get(machineCode) ?? { events: 0, critical: 0 };
      bucket.events += 1;
      if (severity === "high" || severity === "critical") {
        bucket.critical += 1;
      }
      map.set(machineCode, bucket);
    }

    return [...map.entries()]
      .map(([machineCode, value]) => ({ machineCode, ...value }))
      .sort((a, b) => b.critical - a.critical || b.events - a.events)
      .slice(0, 8);
  }, [streamEvents]);
  const allowedSections = (siteContext?.allowedSections as Record<string, unknown> | undefined) ?? {
    overview: true,
    ironmind: true,
    departments: true,
    enterprise: true,
    admin: true
  };
  const siteRoleLabel = String(siteContext?.role ?? "unknown");
  const routeSections: Array<{ key: DashboardSection; label: string; enabled: boolean }> = [
    { key: "overview", label: "Overview", enabled: true },
    { key: "ironmind", label: "Ironmind", enabled: Boolean(allowedSections.ironmind) },
    { key: "departments", label: "Departments", enabled: Boolean(allowedSections.departments) },
    { key: "enterprise", label: "Enterprise", enabled: Boolean(allowedSections.enterprise) },
    { key: "admin", label: "Admin", enabled: Boolean(allowedSections.admin) }
  ];
  const typedRouteSections: RouteSection[] = routeSections;

  return (
    <main className="page">
      <div className="glow glow-a" />
      <div className="glow glow-b" />

      <header className="hero">
        <p className="tag">IRONLOG V2</p>
        <h1>Mining Operations Command Center</h1>
        <p>
          Unified Plant, Operations, HSE, HR, Quality, Ironmind AI, and Logistics control layer
          for daily execution and weekly commercial reporting.
        </p>
      </header>

      {!isAuthenticated && (
        <section className="panel login-panel">
          <h3>Sign In</h3>
          <form onSubmit={onLogin} className="login-form">
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </label>
            <label>
              Password
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
            </label>
            <button type="submit">Enter Command Center</button>
          </form>
        </section>
      )}

      {error && <section className="error">{error}</section>}
      {sessionExpiredMessage && <section className="session-expired">{sessionExpiredMessage}</section>}
      {isAuthenticated && liveToasts.length > 0 && (
        <aside className="toast-stack" aria-live="polite" aria-atomic="true">
          {liveToasts.map((toast) => (
            <article key={toast.id} className={`live-toast tone-${toast.tone}`}>
              <strong>{toast.title}</strong>
              <p>{toast.detail}</p>
              <button type="button" className="toast-ack" onClick={() => acknowledgeToast(toast.id)}>Acknowledge</button>
            </article>
          ))}
        </aside>
      )}

      {!isAuthenticated ? null : (
        <>
          <SiteRouteControlPanel
            enterpriseSiteCode={enterpriseSiteCode}
            siteRoleLabel={siteRoleLabel}
            activeSection={activeSection}
            routeSections={typedRouteSections}
            onNavigate={navigateToSection}
          />

          <TopKpiSummaryGrid
            mtbf={plant?.maintenance.mtbf ?? "-"}
            mttr={plant?.maintenance.mttr ?? "-"}
            utilizationAvg={utilizationAvg}
            tonnesHauled={(operations?.tonnesHauled as number | undefined) ?? "-"}
          />

          <section className="panel" aria-labelledby="plant-availability-heading">
            <h3 id="plant-availability-heading">Plant Availability and Fuel</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Availability %</th>
                    <th>Utilization %</th>
                    <th>Fuel (L)</th>
                  </tr>
                </thead>
                <tbody>
                  {(plant?.availability ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.availability}</td>
                      <td>{row.utilization}</td>
                      <td>{row.fuelLiters}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {activeSection === "overview" && (
          <section className="panel operator-panel" id="overview-section-panel" aria-labelledby="overview-heading" role="region">
            <h3 id="overview-heading">Mobile Operator Capture</h3>
            <p className="admin-note">Fast field entry for hours, shift, and fuel per machine.</p>
            <p className="admin-note">{operatorStatus}</p>
            <div className="operator-sync-row">
              <span className="admin-note">Offline queue: {operatorQueue.length}</span>
              <button type="button" onClick={() => void syncQueuedOperatorEntries()} disabled={operatorQueue.length === 0}>
                Sync Queued Entries
              </button>
            </div>
            <form className="operator-form" onSubmit={onSubmitOperatorEntry}>
              <input type="date" value={operatorDate} onChange={(e) => setOperatorDate(e.target.value)} />
              <input value={operatorMachine} onChange={(e) => setOperatorMachine(e.target.value)} placeholder="Machine code" />
              <input value={operatorShift} onChange={(e) => setOperatorShift(e.target.value)} placeholder="Shift" />
              <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="Operator" />
              <input type="number" step="0.1" value={operatorHoursRun} onChange={(e) => setOperatorHoursRun(Number(e.target.value))} placeholder="Hours run" />
              <input type="number" step="0.1" value={operatorHoursAvailable} onChange={(e) => setOperatorHoursAvailable(Number(e.target.value))} placeholder="Hours available" />
              <input type="number" step="0.1" value={operatorFuelLiters} onChange={(e) => setOperatorFuelLiters(Number(e.target.value))} placeholder="Fuel liters" />
              <button type="submit">Submit Field Entry</button>
            </form>

            <div className="mobile-cards">
              {operatorRecent.slice(0, 6).map((row, index) => (
                <article className="mobile-card" key={index}>
                  <strong>{String(row.machineCode ?? "-")}</strong>
                  <p>{String(row.entryDate ?? "-")} | {String(row.shiftName ?? "-")}</p>
                  <p>Run: {String(row.hoursRun ?? "-")}h / Avail: {String(row.hoursAvailable ?? "-")}h</p>
                  <p>Fuel: {String(row.fuelLiters ?? "-")} L</p>
                </article>
              ))}
            </div>
          </section>
          )}

          {activeSection === "ironmind" && Boolean(allowedSections.ironmind) && (
          <section className="panel" id="ironmind-section-panel" aria-labelledby="ironmind-heading" role="region">
            <h3 id="ironmind-heading">Ironmind Tactical Intel</h3>
            <p className="admin-note">Pattern intelligence for repeat failures, channel reliability, and scenario simulation.</p>
            <p className="admin-note">{ironmindStatus}</p>
            <div className="alert-controls">
              <label className="toggle-row">
                <input type="checkbox" checked={criticalSoundEnabled} onChange={(e) => setCriticalSoundEnabled(e.target.checked)} />
                Critical sound alerts enabled
              </label>
              <button type="button" onClick={() => muteAlerts(10)}>Mute 10m</button>
              <button type="button" onClick={() => muteAlerts(30)}>Mute 30m</button>
              <button type="button" onClick={() => setAlertMuteUntil(null)}>Unmute</button>
              <span className="admin-note">
                {alertMuteUntil && alertMuteUntil > Date.now() ? `Muted until ${new Date(alertMuteUntil).toLocaleTimeString()}` : "Live alerts active"}
              </span>
            </div>

            <div className="badge-grid">
              {machineRealtimeCounters.map((item) => (
                <article className="realtime-badge" key={item.machineCode}>
                  <strong>{item.machineCode}</strong>
                  <span>Events: {item.events}</span>
                  <span>High/Critical: {item.critical}</span>
                </article>
              ))}
            </div>

            <div className="admin-grid">
              <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void onRefreshIronmindIntel(); }}>
                <h4>Refresh Intel Window</h4>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={ironmindWindowHours}
                  onChange={(e) => setIronmindWindowHours(Number(e.target.value))}
                  placeholder="Window hours"
                />
                <input
                  value={timelineMachineFilter}
                  onChange={(e) => setTimelineMachineFilter(e.target.value)}
                  placeholder="Machine filter (optional)"
                />
                <button type="submit">Refresh Tactical Intel</button>
              </form>

              <form className="admin-form" onSubmit={onRunWhatIf}>
                <h4>What-If Simulator</h4>
                <input value={whatIfMachineCode} onChange={(e) => setWhatIfMachineCode(e.target.value)} placeholder="Machine code" />
                <input value={whatIfFaultCode} onChange={(e) => setWhatIfFaultCode(e.target.value)} placeholder="Fault code" />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={whatIfIncomingEvents}
                  onChange={(e) => setWhatIfIncomingEvents(Number(e.target.value))}
                  placeholder="Incoming events"
                />
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={whatIfWindowHours}
                  onChange={(e) => setWhatIfWindowHours(Number(e.target.value))}
                  placeholder="Window hours"
                />
                <button type="submit">Run Simulation</button>
                {whatIfResult && <pre className="audit-json">{JSON.stringify(whatIfResult, null, 2)}</pre>}
              </form>
            </div>

            <div className="kpi-grid">
              <article className="kpi-card">
                <p>Fault Events ({ironmindWindowHours}h)</p>
                <h2>{String((ironmindOverview?.totals as Record<string, unknown> | undefined)?.events ?? "-")}</h2>
              </article>
              <article className="kpi-card">
                <p>Notification Throughput</p>
                <h2>{String((ironmindOverview?.totals as Record<string, unknown> | undefined)?.notifications ?? "-")}</h2>
              </article>
              <article className="kpi-card">
                <p>Average Risk / Event</p>
                <h2>{String((ironmindOverview?.totals as Record<string, unknown> | undefined)?.avgRiskPerEvent ?? "-")}</h2>
              </article>
              <article className="kpi-card">
                <p>Critical Ratio %</p>
                <h2>{String((ironmindOverview?.totals as Record<string, unknown> | undefined)?.criticalRatio ?? "-")}</h2>
              </article>
            </div>

            <div className="admin-table-wrap">
              <h4>Top Fault Clusters</h4>
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Fault</th>
                    <th>Occurrences</th>
                    <th>Severity Score</th>
                    <th>Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ironmindTopFaults.map((item, index) => (
                    <tr key={index} className={recentFaultKeys.has(`${String(item.machineCode ?? "")}:${String(item.faultCode ?? "")}`) ? "realtime-highlight" : ""}>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.faultCode ?? "-")}</td>
                      <td>{String(item.occurrences ?? "-")}</td>
                      <td>{String(item.severityScore ?? "-")}</td>
                      <td>{String(item.riskScore ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Hot Machines</h4>
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Occurrences</th>
                    <th>Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ironmindHotMachines.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.occurrences ?? "-")}</td>
                      <td>{String(item.riskScore ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Notification Channel Health</h4>
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Sent</th>
                    <th>Failed</th>
                    <th>Total</th>
                    <th>Success %</th>
                  </tr>
                </thead>
                <tbody>
                  {ironmindChannelHealth.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.channel ?? "-")}</td>
                      <td>{String(item.sent ?? "-")}</td>
                      <td>{String(item.failed ?? "-")}</td>
                      <td>{String(item.total ?? "-")}</td>
                      <td>{String(item.successRate ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Latest Fault Timeline</h4>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Machine</th>
                    <th>Fault</th>
                    <th>Severity</th>
                    <th>Recurrence</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {ironmindTimeline.slice(0, 12).map((item, index) => (
                    <tr key={index} className={recentFaultKeys.has(`${String(item.machineCode ?? "")}:${String(item.faultCode ?? "")}`) ? "realtime-highlight" : ""}>
                      <td>{String(item.occurredAt ?? "-")}</td>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.faultCode ?? "-")}</td>
                      <td>{String(item.severity ?? "-")}</td>
                      <td>{String(item.recurrenceCount ?? "-")}</td>
                      <td>{String(item.riskScore ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Recommended Actions</h4>
              <table>
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Title</th>
                    <th>Owner</th>
                    <th>ETA (h)</th>
                    <th>Action</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {ironmindRecommendations.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.priority ?? "-")}</td>
                      <td>{String(item.title ?? "-")}</td>
                      <td>{String(item.owner ?? "-")}</td>
                      <td>{String(item.etaHours ?? "-")}</td>
                      <td>{String(item.action ?? "-")}</td>
                      <td>{String(item.rationale ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-grid">
              <form className="admin-form" onSubmit={onCreateInvestigationCase}>
                <h4>Open Investigation Case</h4>
                <input value={newCaseMachineCode} onChange={(e) => setNewCaseMachineCode(e.target.value)} placeholder="Machine code" />
                <input value={newCaseFaultCode} onChange={(e) => setNewCaseFaultCode(e.target.value)} placeholder="Fault code" />
                <select value={newCaseSeverity} onChange={(e) => setNewCaseSeverity(e.target.value as "low" | "warning" | "high" | "critical")}>
                  <option value="low">low</option>
                  <option value="warning">warning</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
                <input value={newCaseTitle} onChange={(e) => setNewCaseTitle(e.target.value)} placeholder="Case title" />
                <textarea value={newCaseDescription} onChange={(e) => setNewCaseDescription(e.target.value)} rows={4} />
                <input value={newCaseOwner} onChange={(e) => setNewCaseOwner(e.target.value)} placeholder="Case owner" />
                <button type="submit">Open Investigation</button>
              </form>

              <form className="admin-form" onSubmit={onAddCaseAction}>
                <h4>Add Investigation Action</h4>
                <select
                  value={selectedCaseId === "" ? "" : String(selectedCaseId)}
                  onChange={(e) => setSelectedCaseId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Select case</option>
                  {investigationCases.map((item, index) => (
                    <option key={index} value={String(item.id)}>
                      {String(item.caseCode ?? "-")} | {String(item.machineCode ?? "-")} | {String(item.status ?? "-")}
                    </option>
                  ))}
                </select>
                <input value={caseActionTitle} onChange={(e) => setCaseActionTitle(e.target.value)} placeholder="Action title" />
                <input value={caseActionOwner} onChange={(e) => setCaseActionOwner(e.target.value)} placeholder="Action owner" />
                <input type="datetime-local" value={caseActionDueAt} onChange={(e) => setCaseActionDueAt(e.target.value)} />
                <textarea value={caseActionNotes} onChange={(e) => setCaseActionNotes(e.target.value)} rows={4} />
                <button type="submit">Add Action</button>
                <input value={caseClosureSummary} onChange={(e) => setCaseClosureSummary(e.target.value)} placeholder="Closure summary" />
                <button type="button" onClick={onCloseCase}>Close Selected Case</button>
              </form>

              <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void refreshIronmindIntel(); }}>
                <h4>Predictive Model Window</h4>
                <input
                  type="number"
                  min={12}
                  max={168}
                  value={predictiveHorizonHours}
                  onChange={(e) => setPredictiveHorizonHours(Number(e.target.value))}
                  placeholder="Prediction horizon (hours)"
                />
                <input
                  type="number"
                  min={24}
                  max={720}
                  value={predictiveWindowHours}
                  onChange={(e) => setPredictiveWindowHours(Number(e.target.value))}
                  placeholder="Source window (hours)"
                />
                <button type="submit">Refresh Predictive Scores</button>
                <p className="admin-note">{streamStatus}</p>
              </form>
            </div>

            <div className="admin-table-wrap">
              <h4>Predictive Failure Probability</h4>
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Risk Band</th>
                    <th>Probability Next Horizon %</th>
                    <th>Window Hours</th>
                    <th>Occurrences</th>
                    <th>Recent Occurrences</th>
                  </tr>
                </thead>
                <tbody>
                  {predictiveRows.map((row, index) => {
                    const observations = (row.observations ?? {}) as Record<string, unknown>;
                    return (
                      <tr key={index}>
                        <td>{String(row.machineCode ?? "-")}</td>
                        <td>{String(row.riskBand ?? "-")}</td>
                        <td>{String(row.probabilityNextHorizonPct ?? "-")}</td>
                        <td>{String(observations.sourceWindowHours ?? "-")}</td>
                        <td>{String(observations.occurrences ?? "-")}</td>
                        <td>{String(observations.recentOccurrences ?? "-")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Investigation Cases</h4>
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Status</th>
                    <th>Machine</th>
                    <th>Fault</th>
                    <th>Severity</th>
                    <th>Owner</th>
                    <th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {investigationCases.map((item, index) => (
                    <tr key={index} className={recentCaseIds.has(Number(item.id)) ? "realtime-highlight" : ""}>
                      <td>{String(item.caseCode ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.faultCode ?? "-")}</td>
                      <td>{String(item.severity ?? "-")}</td>
                      <td>{String(item.ownerName ?? "-")}</td>
                      <td>{String(item.openedAt ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Live Stream Events</h4>
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Type</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {streamEvents.map((event, index) => (
                    <tr key={index} className={index < 2 ? "realtime-highlight" : ""}>
                      <td>{String(event.receivedAt ?? "-")}</td>
                      <td>{String(event.type ?? "-")}</td>
                      <td><pre className="audit-json">{JSON.stringify(event.payload ?? {}, null, 2)}</pre></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          )}

          {activeSection === "departments" && Boolean(allowedSections.departments) && (
          <section className="panel" id="departments-section-panel" aria-labelledby="departments-heading" role="region">
            <h3 id="departments-heading">All Departments Data Dump</h3>
            <p className="admin-note">Operational payloads for Operations, HSE, HR, Quality, and Logistics.</p>
            <div className="health-link-row">
              <button type="button" onClick={() => void refreshDepartmentDump()}>Refresh Department Dumps</button>
            </div>

            <div className="admin-table-wrap">
              <h4>Operations Fleet Performance</h4>
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Tonnes</th>
                    <th>Cycle Min</th>
                    <th>Availability %</th>
                    <th>Fuel Liters</th>
                  </tr>
                </thead>
                <tbody>
                  {operationsFleet.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.tonnes ?? "-")}</td>
                      <td>{String(item.cycleTimeMin ?? "-")}</td>
                      <td>{String(item.availabilityPct ?? "-")}</td>
                      <td>{String(item.fuelLiters ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>HSE Incident Register</h4>
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th>Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {hseIncidents.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.incidentCode ?? "-")}</td>
                      <td>{String(item.category ?? "-")}</td>
                      <td>{String(item.severity ?? "-")}</td>
                      <td>{String(item.area ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                      <td>{String(item.loggedAt ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>HR Training Expiry Watch</h4>
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Name</th>
                    <th>Competency</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {hrTrainingExpiring.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.employeeNo ?? "-")}</td>
                      <td>{String(item.name ?? "-")}</td>
                      <td>{String(item.competency ?? "-")}</td>
                      <td>{String(item.expiresAt ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Quality Lab Results</h4>
              <table>
                <thead>
                  <tr>
                    <th>Sample</th>
                    <th>Source</th>
                    <th>Fe %</th>
                    <th>SiO2 %</th>
                    <th>Moisture %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {qualityLabResults.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.sampleId ?? "-")}</td>
                      <td>{String(item.source ?? "-")}</td>
                      <td>{String(item.feGradePct ?? "-")}</td>
                      <td>{String(item.sio2Pct ?? "-")}</td>
                      <td>{String(item.moisturePct ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Logistics Trip Board</h4>
              <table>
                <thead>
                  <tr>
                    <th>Trip</th>
                    <th>Route</th>
                    <th>ETA Hours</th>
                    <th>Status</th>
                    <th>On Time</th>
                  </tr>
                </thead>
                <tbody>
                  {logisticsTrips.map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.tripNo ?? "-")}</td>
                      <td>{String(item.route ?? "-")}</td>
                      <td>{String(item.etaHours ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                      <td>{String(item.onTime ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          )}

          {activeSection === "enterprise" && Boolean(allowedSections.enterprise) && (
          <section className="panel" id="enterprise-section-panel" aria-labelledby="enterprise-heading" role="region">
            <h3 id="enterprise-heading">Enterprise Scale Lab</h3>
            <p className="admin-note">Unified site overview plus synthetic data engine to scale-test every department fast.</p>
            <p className="admin-note">{syntheticStatus}</p>

            <div className="admin-grid">
              <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void refreshEnterpriseOverview(enterpriseWindowHours); }}>
                <h4>Refresh Enterprise Overview</h4>
                <input
                  value={enterpriseSiteCode}
                  onChange={(e) => setEnterpriseSiteCode(e.target.value.toUpperCase())}
                  placeholder="Site code (e.g. SITE-A)"
                />
                <input
                  type="number"
                  min={24}
                  max={720}
                  value={enterpriseWindowHours}
                  onChange={(e) => setEnterpriseWindowHours(Number(e.target.value))}
                  placeholder="Overview window hours"
                />
                <button type="submit">Refresh Enterprise Snapshot</button>
                <button type="button" onClick={() => void onDownloadEnterpriseBundle()}>Download JSON+CSV Bundle</button>
                <button type="button" onClick={() => void onPersistEnterpriseBundle()}>Persist Export Artifact</button>
                <pre className="audit-json">{JSON.stringify(enterpriseOverview?.enterpriseKpis ?? {}, null, 2)}</pre>
              </form>

              <form className="admin-form" onSubmit={onRunSyntheticLoad}>
                <h4>Generate Synthetic Site Load</h4>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={syntheticDays}
                  onChange={(e) => setSyntheticDays(Number(e.target.value))}
                  placeholder="Days"
                />
                <textarea
                  value={syntheticMachinesCsv}
                  onChange={(e) => setSyntheticMachinesCsv(e.target.value)}
                  rows={3}
                  placeholder="Machine codes comma-separated"
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={syntheticEventsPerDay}
                  onChange={(e) => setSyntheticEventsPerDay(Number(e.target.value))}
                  placeholder="Events per day per machine"
                />
                <select
                  value={syntheticScenarioTemplate}
                  onChange={(e) => setSyntheticScenarioTemplate(e.target.value as "normal" | "stress" | "incident_surge")}
                >
                  <option value="normal">normal</option>
                  <option value="stress">stress</option>
                  <option value="incident_surge">incident_surge</option>
                </select>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={syntheticCriticalSpike}
                    onChange={(e) => setSyntheticCriticalSpike(e.target.checked)}
                  />
                  Include critical spike in recent days
                </label>
                <button type="submit">Run Synthetic Generator</button>
              </form>

              <form className="admin-form" onSubmit={onCreateSite}>
                <h4>Create or Update Site</h4>
                <input value={newSiteCode} onChange={(e) => setNewSiteCode(e.target.value.toUpperCase())} placeholder="Site code" />
                <input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="Site name" />
                <input value={newSiteRegion} onChange={(e) => setNewSiteRegion(e.target.value)} placeholder="Region" />
                <button type="submit">Save Site</button>
              </form>

              <form className="admin-form" onSubmit={onGrantSiteAccess}>
                <h4>Grant Site Access</h4>
                <select
                  value={grantSiteId === "" ? "" : String(grantSiteId)}
                  onChange={(e) => setGrantSiteId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Select site</option>
                  {siteItems.map((site, index) => (
                    <option key={index} value={String(site.id)}>{String(site.siteCode ?? "-")} | {String(site.name ?? "-")}</option>
                  ))}
                </select>
                <select value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)}>
                  <option value="">Select user</option>
                  {(rbac?.users ?? []).map((user) => (
                    <option key={user.id} value={user.id}>{user.email} ({user.fullName})</option>
                  ))}
                </select>
                <select value={grantRole} onChange={(e) => setGrantRole(e.target.value as "viewer" | "operator" | "manager" | "admin")}>
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="manager">manager</option>
                  <option value="admin">admin</option>
                </select>
                <button type="submit">Grant Access</button>
              </form>
            </div>

            <div className="kpi-grid">
              <article className="kpi-card">
                <p>Enterprise Utilization %</p>
                <h2>{String((enterpriseOverview?.enterpriseKpis as Record<string, unknown> | undefined)?.utilizationPct ?? "-")}</h2>
              </article>
              <article className="kpi-card">
                <p>Fuel Cost / Run Hour</p>
                <h2>{String((enterpriseOverview?.enterpriseKpis as Record<string, unknown> | undefined)?.fuelCostPerRunHour ?? "-")}</h2>
              </article>
              <article className="kpi-card">
                <p>Open HSE Incidents</p>
                <h2>{String((enterpriseOverview?.enterpriseKpis as Record<string, unknown> | undefined)?.openHseIncidents ?? "-")}</h2>
              </article>
              <article className="kpi-card">
                <p>Delayed Trips</p>
                <h2>{String((enterpriseOverview?.enterpriseKpis as Record<string, unknown> | undefined)?.delayedTrips ?? "-")}</h2>
              </article>
            </div>

            <div className="admin-table-wrap">
              <h4>Cross-Site Executive Comparison</h4>
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Utilization %</th>
                    <th>Fuel/Run Hour</th>
                    <th>Critical Fault %</th>
                    <th>Delayed Trips</th>
                    <th>Open HSE</th>
                    <th>Variance Heat</th>
                  </tr>
                </thead>
                <tbody>
                  {crossSiteComparison.slice(0, 12).map((item, index) => {
                    const variance = (item.variance ?? {}) as Record<string, unknown>;
                    const heatScore =
                      Math.abs(Number(variance.utilizationPct ?? 0)) +
                      Math.abs(Number(variance.fuelCostPerRunHour ?? 0)) +
                      Math.abs(Number(variance.criticalFaultRatioPct ?? 0));
                    const heatClass = heatScore >= 20 ? "heat-high" : heatScore >= 10 ? "heat-medium" : "heat-low";

                    return (
                      <tr key={index} className={heatClass}>
                        <td>{String(item.siteCode ?? "-")} | {String(item.siteName ?? "-")}</td>
                        <td>{String(item.utilizationPct ?? "-")}</td>
                        <td>{String(item.fuelCostPerRunHour ?? "-")}</td>
                        <td>{String(item.criticalFaultRatioPct ?? "-")}</td>
                        <td>{String(item.delayedTrips ?? "-")}</td>
                        <td>{String(item.openHseIncidents ?? "-")}</td>
                        <td>
                          U:{String(variance.utilizationPct ?? 0)} | F:{String(variance.fuelCostPerRunHour ?? 0)} | C:{String(variance.criticalFaultRatioPct ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Synthetic Load Job Runs</h4>
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {syntheticRuns.slice(0, 12).map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.startedAt ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                      <td><pre className="audit-json">{JSON.stringify(item.details ?? {}, null, 2)}</pre></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Trend Snapshots</h4>
              <div className="trend-grid">
                <article className="trend-card">
                  <h5>Fuel Liters</h5>
                  <div className="sparkline-row">
                    {(((enterpriseTrends?.series as Record<string, unknown> | undefined)?.fuel as Array<Record<string, unknown>> | undefined) ?? []).slice(-14).map((point, index) => (
                      <span key={index} className="spark" style={{ height: `${Math.max(8, Number(point.liters ?? 0) / 30)}px` }} title={`${String(point.bucketDate ?? "")}: ${String(point.liters ?? 0)}`} />
                    ))}
                  </div>
                </article>
                <article className="trend-card">
                  <h5>Run Hours</h5>
                  <div className="sparkline-row">
                    {(((enterpriseTrends?.series as Record<string, unknown> | undefined)?.runHours as Array<Record<string, unknown>> | undefined) ?? []).slice(-14).map((point, index) => (
                      <span key={index} className="spark" style={{ height: `${Math.max(8, Number(point.runHours ?? 0) * 4)}px` }} title={`${String(point.bucketDate ?? "")}: ${String(point.runHours ?? 0)}`} />
                    ))}
                  </div>
                </article>
                <article className="trend-card">
                  <h5>Fault Count</h5>
                  <div className="sparkline-row">
                    {(((enterpriseTrends?.series as Record<string, unknown> | undefined)?.faults as Array<Record<string, unknown>> | undefined) ?? []).slice(-14).map((point, index) => (
                      <span key={index} className="spark spark-danger" style={{ height: `${Math.max(8, Number(point.count ?? 0) * 5)}px` }} title={`${String(point.bucketDate ?? "")}: ${String(point.count ?? 0)}`} />
                    ))}
                  </div>
                </article>
              </div>
            </div>

            <div className="admin-table-wrap">
              <h4>Persisted Export Artifacts</h4>
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Type</th>
                    <th>Site</th>
                    <th>File</th>
                    <th>Action</th>
                    <th>Token Link</th>
                  </tr>
                </thead>
                <tbody>
                  {exportArtifacts.slice(0, 12).map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.createdAt ?? "-")}</td>
                      <td>{String(item.artifactType ?? "-")}</td>
                      <td>{String(item.siteCode ?? "-")}</td>
                      <td>{String(item.fileName ?? "-")}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void onDownloadArtifact(Number(item.id), String(item.fileName ?? "artifact.json"))}
                        >
                          Download
                        </button>
                      </td>
                      <td>
                        <button type="button" onClick={() => void onCreateArtifactToken(Number(item.id))}>Create Token</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Execution Control Loop</h4>
              <p className="admin-note">Digital work orders, supervisor approvals, shift command board, and cost/downtime attribution.</p>
              <p className="admin-note">{workOrderStatus}</p>

              <div className="admin-grid">
                <form className="admin-form" onSubmit={onCreateWorkOrder}>
                  <h4>Open Work Order</h4>
                  <input value={newWorkOrderDepartment} onChange={(e) => setNewWorkOrderDepartment(e.target.value)} placeholder="Department" />
                  <input value={newWorkOrderMachineCode} onChange={(e) => setNewWorkOrderMachineCode(e.target.value)} placeholder="Machine code" />
                  <input value={newWorkOrderFaultCode} onChange={(e) => setNewWorkOrderFaultCode(e.target.value)} placeholder="Fault code" />
                  <input value={newWorkOrderTitle} onChange={(e) => setNewWorkOrderTitle(e.target.value)} placeholder="Work order title" />
                  <textarea value={newWorkOrderDescription} onChange={(e) => setNewWorkOrderDescription(e.target.value)} rows={4} />
                  <select value={newWorkOrderPriority} onChange={(e) => setNewWorkOrderPriority(e.target.value as "low" | "medium" | "high" | "critical")}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                  <input value={newWorkOrderAssignedTo} onChange={(e) => setNewWorkOrderAssignedTo(e.target.value)} placeholder="Assigned to" />
                  <input type="datetime-local" value={newWorkOrderDueAt} onChange={(e) => setNewWorkOrderDueAt(e.target.value)} />
                  <input type="number" min={0} step="100" value={newWorkOrderEstimatedCost} onChange={(e) => setNewWorkOrderEstimatedCost(Number(e.target.value))} placeholder="Estimated cost" />
                  <input type="number" min={0} step="0.1" value={newWorkOrderDowntimeHours} onChange={(e) => setNewWorkOrderDowntimeHours(Number(e.target.value))} placeholder="Downtime hours" />
                  <button type="submit">Open Work Order</button>
                </form>

                <form className="admin-form" onSubmit={onUpdateWorkOrderState}>
                  <h4>Progress and Closure</h4>
                  <select
                    value={selectedWorkOrderId === "" ? "" : String(selectedWorkOrderId)}
                    onChange={(e) => setSelectedWorkOrderId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Select work order</option>
                    {workOrders.slice(0, 120).map((item, index) => (
                      <option key={index} value={String(item.id)}>
                        {String(item.workOrderCode ?? "-")} | {String(item.status ?? "-")} | {String(item.priority ?? "-")}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedWorkOrderStatus}
                    onChange={(e) => setSelectedWorkOrderStatus(
                      e.target.value as "open" | "assigned" | "in_progress" | "blocked" | "pending_approval" | "approved" | "closed"
                    )}
                  >
                    <option value="open">open</option>
                    <option value="assigned">assigned</option>
                    <option value="in_progress">in_progress</option>
                    <option value="blocked">blocked</option>
                    <option value="pending_approval">pending_approval</option>
                    <option value="approved">approved</option>
                    <option value="closed">closed</option>
                  </select>
                  <button type="submit">Update Status</button>
                  <button type="button" onClick={() => void onRequestSelectedWorkOrderApproval()}>Request Approval</button>
                  <button type="button" onClick={() => void onApproveSelectedWorkOrder()}>Supervisor Approve</button>
                  <input
                    type="number"
                    min={0}
                    step="100"
                    value={selectedWorkOrderActualCost}
                    onChange={(e) => setSelectedWorkOrderActualCost(Number(e.target.value))}
                    placeholder="Actual cost"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={selectedWorkOrderDowntimeHours}
                    onChange={(e) => setSelectedWorkOrderDowntimeHours(Number(e.target.value))}
                    placeholder="Downtime hours"
                  />
                  <textarea value={selectedWorkOrderEvidence} onChange={(e) => setSelectedWorkOrderEvidence(e.target.value)} rows={3} placeholder="Evidence / closure notes" />
                  <button type="button" onClick={() => void onCloseSelectedWorkOrder()}>Close Work Order</button>
                </form>

                <div className="role-scorecard">
                  <h4>Role Scorecard</h4>
                  <pre>{JSON.stringify(workOrderScorecard ?? {}, null, 2)}</pre>
                </div>

                <form className="admin-form" onSubmit={onCreateSlaRule}>
                  <h4>SLA and Escalation Rules</h4>
                  <input value={slaRuleName} onChange={(e) => setSlaRuleName(e.target.value)} placeholder="Rule name" />
                  <select value={slaRulePriority} onChange={(e) => setSlaRulePriority(e.target.value as "low" | "medium" | "high" | "critical")}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                  <input value={slaRuleDepartment} onChange={(e) => setSlaRuleDepartment(e.target.value)} placeholder="Department" />
                  <input type="number" min={0.5} step="0.5" value={slaRuleBreachHours} onChange={(e) => setSlaRuleBreachHours(Number(e.target.value))} placeholder="Breach hours" />
                  <select value={slaRuleChannel} onChange={(e) => setSlaRuleChannel(e.target.value as "email" | "teams_webhook" | "whatsapp_webhook")}>
                    <option value="email">email</option>
                    <option value="teams_webhook">teams_webhook</option>
                    <option value="whatsapp_webhook">whatsapp_webhook</option>
                  </select>
                  <input value={slaRuleRecipient} onChange={(e) => setSlaRuleRecipient(e.target.value)} placeholder="Recipient" />
                  <label className="toggle-row">
                    <input type="checkbox" checked={slaRuleAutoApproval} onChange={(e) => setSlaRuleAutoApproval(e.target.checked)} />
                    Auto request approval on breach
                  </label>
                  <button type="submit">Save SLA Rule</button>
                  <select value={selectedSlaRuleId === "" ? "" : String(selectedSlaRuleId)} onChange={(e) => setSelectedSlaRuleId(e.target.value ? Number(e.target.value) : "") }>
                    <option value="">Select SLA rule</option>
                    {workOrderSlaRules.map((rule, index) => (
                      <option key={index} value={String(rule.id)}>
                        {String(rule.name ?? "-")} | {String(rule.enabled ? "enabled" : "disabled")}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void onToggleSelectedSlaRule(true)}>Enable Rule</button>
                  <button type="button" onClick={() => void onToggleSelectedSlaRule(false)}>Disable Rule</button>
                  <button type="button" onClick={() => void onRunSlaEvaluationNow()}>Run SLA Evaluation Now</button>
                </form>

                <form className="admin-form" onSubmit={onUploadAttachment}>
                  <h4>Evidence Attachments and Executive Report</h4>
                  <input type="file" onChange={(e) => setSelectedAttachmentFile(e.target.files?.[0] ?? null)} />
                  <input value={attachmentNotes} onChange={(e) => setAttachmentNotes(e.target.value)} placeholder="Attachment notes" />
                  {attachmentPreviewUrl && (
                    <img
                      src={attachmentPreviewUrl}
                      alt="Attachment preview"
                      style={{ width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "8px", border: "1px solid #2f3a52" }}
                    />
                  )}
                  <button type="submit">Upload Evidence</button>
                  <button type="button" onClick={() => void onGenerateExecutiveReport()}>Generate Executive Shift PDF</button>
                  <button type="button" onClick={() => void onDispatchExecutiveReportNow()}>Dispatch Scheduled Report Now</button>
                  <button type="button" onClick={() => void onRetryEscalationsNow()}>Retry Failed Escalations</button>
                  <p className="admin-note">{executiveReportStatus}</p>
                </form>
              </div>
            </div>

            <div className="kpi-grid">
              <article className="kpi-card">
                <p>Open + Assigned</p>
                <h2>{String((workOrderBoard?.backlog as Record<string, unknown> | undefined)?.open ?? 0)} / {String((workOrderBoard?.backlog as Record<string, unknown> | undefined)?.assigned ?? 0)}</h2>
              </article>
              <article className="kpi-card">
                <p>In Progress</p>
                <h2>{String((workOrderBoard?.backlog as Record<string, unknown> | undefined)?.inProgress ?? 0)}</h2>
              </article>
              <article className="kpi-card">
                <p>Blocked</p>
                <h2>{String((workOrderBoard?.backlog as Record<string, unknown> | undefined)?.blocked ?? 0)}</h2>
              </article>
              <article className="kpi-card">
                <p>Pending Approvals</p>
                <h2>{String((workOrderBoard?.backlog as Record<string, unknown> | undefined)?.pendingApproval ?? 0)}</h2>
              </article>
            </div>

            <div className="admin-table-wrap">
              <h4>Shift Command Board: Overdue and Blocked</h4>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Assigned</th>
                    <th>Due / Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...(((workOrderBoard?.overdue as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10)),
                    ...(((workOrderBoard?.blocked as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 10))
                  ].map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.workOrderCode ?? "-")}</td>
                      <td>{String(item.title ?? "-")}</td>
                      <td>{String(item.status ?? "blocked")}</td>
                      <td>{String(item.priority ?? "-")}</td>
                      <td>{String(item.assignedToName ?? "Unassigned")}</td>
                      <td>{String(item.dueAt ?? item.updatedAt ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Cost and Downtime Attribution by Machine</h4>
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Work Orders</th>
                    <th>Actual Cost</th>
                    <th>Downtime Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {(((workOrderAttribution?.byMachine as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 20)).map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.workOrders ?? "-")}</td>
                      <td>{String(item.actualCost ?? "-")}</td>
                      <td>{String(item.downtimeHours ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Department Attribution</h4>
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Work Orders</th>
                    <th>Actual Cost</th>
                    <th>Downtime Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {(((workOrderAttribution?.byDepartment as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 20)).map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.department ?? "-")}</td>
                      <td>{String(item.workOrders ?? "-")}</td>
                      <td>{String(item.actualCost ?? "-")}</td>
                      <td>{String(item.downtimeHours ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Digital Work Order Register</h4>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Department</th>
                    <th>Machine</th>
                    <th>Title</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Approval</th>
                    <th>Est/Actual Cost</th>
                    <th>Downtime</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.slice(0, 120).map((item, index) => (
                    <tr
                      key={index}
                      className={Number(item.id) === Number(selectedWorkOrderId) ? "realtime-highlight" : ""}
                      onClick={() => setSelectedWorkOrderId(Number(item.id))}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{String(item.workOrderCode ?? "-")}</td>
                      <td>{String(item.department ?? "-")}</td>
                      <td>{String(item.machineCode ?? "-")}</td>
                      <td>{String(item.title ?? "-")}</td>
                      <td>{String(item.priority ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                      <td>{String(item.approvalRequired ? "required" : "not required")}</td>
                      <td>{String(item.estimatedCost ?? "0")} / {String(item.actualCost ?? "0")}</td>
                      <td>{String(item.downtimeHours ?? "0")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Asana-Style Workflow Board</h4>
              <div className="trend-grid">
                {[
                  { key: "open", title: "Open" },
                  { key: "assigned", title: "Assigned" },
                  { key: "in_progress", title: "In Progress" },
                  { key: "blocked", title: "Blocked" },
                  { key: "pending_approval", title: "Pending Approval" },
                  { key: "approved", title: "Approved" },
                  { key: "closed", title: "Closed" }
                ].map((lane) => {
                  const items = ((workflowBoard?.lanes as Record<string, Array<Record<string, unknown>>> | undefined)?.[lane.key] ?? []).slice(0, 8);
                  return (
                    <article className="trend-card" key={lane.key}>
                      <h5>{lane.title} ({items.length})</h5>
                      <div className="mobile-cards">
                        {items.map((item, index) => (
                          <article
                            className="mobile-card"
                            key={index}
                            onClick={() => setSelectedWorkOrderId(Number(item.id))}
                            style={{ cursor: "pointer" }}
                          >
                            <strong>{String(item.workOrderCode ?? "-")}</strong>
                            <p>{String(item.title ?? "-")}</p>
                            <p>Checklist: {String(item.checklistDone ?? 0)}/{String(item.checklistTotal ?? 0)} | Comments: {String(item.commentsTotal ?? 0)}</p>
                            <p>Dependencies blocked: {String(item.dependenciesBlocked ?? 0)}</p>
                          </article>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="admin-grid">
              <form className="admin-form" onSubmit={onAddChecklistItem}>
                <h4>Checklist (selected work order)</h4>
                <input value={newChecklistTitle} onChange={(e) => setNewChecklistTitle(e.target.value)} placeholder="Checklist item" />
                <input value={newChecklistAssignee} onChange={(e) => setNewChecklistAssignee(e.target.value)} placeholder="Assignee" />
                <input type="datetime-local" value={newChecklistDueAt} onChange={(e) => setNewChecklistDueAt(e.target.value)} />
                <button type="submit">Add Checklist Item</button>
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Title</th>
                      <th>Assignee</th>
                      <th>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflowChecklistItems.slice(0, 20).map((item, index) => {
                      const isDone = String(item.status ?? "todo") === "done";
                      return (
                        <tr key={index}>
                          <td>
                            <button type="button" onClick={() => void onToggleChecklistItem(Number(item.id), isDone ? "todo" : "done")}>
                              {isDone ? "Done" : "Todo"}
                            </button>
                          </td>
                          <td>{String(item.title ?? "-")}</td>
                          <td>{String(item.assigneeName ?? "-")}</td>
                          <td>{String(item.dueAt ?? "-")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </form>

              <form className="admin-form" onSubmit={onAddWorkflowComment}>
                <h4>Threaded Comments</h4>
                <textarea value={newWorkflowComment} onChange={(e) => setNewWorkflowComment(e.target.value)} rows={4} />
                <button type="submit">Post Comment</button>
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Author</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflowComments.slice(0, 30).map((item, index) => (
                      <tr key={index}>
                        <td>{String(item.createdAt ?? "-")}</td>
                        <td>{String(item.authorEmail ?? item.authorUserId ?? "-")}</td>
                        <td>{String(item.message ?? "-")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </form>

              <form className="admin-form" onSubmit={onAddDependency}>
                <h4>Dependencies</h4>
                <select
                  value={newDependencyWorkOrderId === "" ? "" : String(newDependencyWorkOrderId)}
                  onChange={(e) => setNewDependencyWorkOrderId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Select dependency work order</option>
                  {workOrders
                    .filter((item) => Number(item.id) !== Number(selectedWorkOrderId))
                    .slice(0, 120)
                    .map((item, index) => (
                      <option key={index} value={String(item.id)}>
                        {String(item.workOrderCode ?? "-")} | {String(item.status ?? "-")} | {String(item.title ?? "-")}
                      </option>
                    ))}
                </select>
                <button type="submit">Add Dependency</button>
                <table>
                  <thead>
                    <tr>
                      <th>Depends On</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflowDependencies.slice(0, 30).map((item, index) => (
                      <tr key={index}>
                        <td>{String(item.dependsOnWorkOrderCode ?? item.dependsOnWorkOrderId ?? "-")}</td>
                        <td>{String(item.dependsOnTitle ?? "-")}</td>
                        <td>{String(item.dependsOnStatus ?? "-")}</td>
                        <td>
                          <button type="button" onClick={() => void onRemoveDependency(Number(item.dependsOnWorkOrderId))}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </form>
            </div>

            <div className="admin-table-wrap">
              <h4>SLA Rules and Escalations</h4>
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Priority</th>
                    <th>Department</th>
                    <th>Breach Hours</th>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrderSlaRules.slice(0, 25).map((rule, index) => (
                    <tr key={index} className={Number(rule.id) === Number(selectedSlaRuleId) ? "realtime-highlight" : ""}>
                      <td>{String(rule.name ?? "-")}</td>
                      <td>{String(rule.appliesPriority ?? "all")}</td>
                      <td>{String(rule.appliesDepartment ?? "all")}</td>
                      <td>{String(rule.breachAfterHours ?? "-")}</td>
                      <td>{String(rule.escalationChannel ?? "-")}</td>
                      <td>{String(rule.escalationRecipient ?? "-")}</td>
                      <td>{String(rule.enabled ? "yes" : "no")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Escalation Feed</h4>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Work Order</th>
                    <th>Type</th>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrderEscalations.slice(0, 30).map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.createdAt ?? "-")}</td>
                      <td>{String(item.workOrderCode ?? "-")}</td>
                      <td>{String(item.escalationType ?? "-")}</td>
                      <td>{String(item.channel ?? "-")}</td>
                      <td>{String(item.recipient ?? "-")}</td>
                      <td>{String(item.status ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-table-wrap">
              <h4>Work Order Evidence Files</h4>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>File</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Notes</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrderAttachments.slice(0, 40).map((item, index) => (
                    <tr key={index}>
                      <td>{String(item.createdAt ?? "-")}</td>
                      <td>{String(item.fileName ?? "-")}</td>
                      <td>{String(item.mimeType ?? "-")}</td>
                      <td>{String(item.fileSizeBytes ?? "-")}</td>
                      <td>{String(item.notes ?? "-")}</td>
                      <td>
                        <button type="button" onClick={() => void onDownloadWorkOrderAttachment(Number(item.id), String(item.fileName ?? "evidence.bin"))}>
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          )}

          <section className="module-grid">
            {cards.map((card) => (
              <article className="module-card" key={card.title}>
                <h3>{card.title}</h3>
                <p>{card.subtitle}</p>
                <ul>
                  {Object.entries(card.data).map(([key, value]) => (
                    <li key={key}>
                      <span>{formatLabel(key)}</span>
                      <strong>{Array.isArray(value) ? value.join(", ") : String(value)}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          {activeSection === "admin" && Boolean(allowedSections.admin) && (
          <section className="panel admin-panel" id="admin-section-panel" aria-labelledby="admin-heading" role="region">
            <h3 id="admin-heading">RBAC Admin Console</h3>
            <p className="admin-note">{rbacStatus}</p>

            {!rbac ? (
              <p className="admin-note">Admin features require system admin permission.</p>
            ) : (
              <>
                <div className="admin-grid">
                  <form className="admin-form" onSubmit={onCreateUser}>
                    <h4>Create User</h4>
                    <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="Email" />
                    <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Full name" />
                    <input value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Password" type="password" />
                    <input value={newUserRoles} onChange={(e) => setNewUserRoles(e.target.value)} placeholder="Roles comma separated" />
                    <button type="submit">Save User</button>
                  </form>

                  <form className="admin-form" onSubmit={onCreateRole}>
                    <h4>Create Role</h4>
                    <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Role name" />
                    <input value={newRolePermissions} onChange={(e) => setNewRolePermissions(e.target.value)} placeholder="Permissions comma separated" />
                    <button type="submit">Save Role</button>
                  </form>

                  <form className="admin-form" onSubmit={onAssignUserRoles}>
                    <h4>Assign User Roles</h4>
                    <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                      <option value="">Select user</option>
                      {rbac.users.map((user) => (
                        <option key={user.id} value={user.id}>{user.email}</option>
                      ))}
                    </select>
                    <input value={selectedUserRoles} onChange={(e) => setSelectedUserRoles(e.target.value)} placeholder="Roles comma separated" />
                    <button type="submit">Apply Roles</button>
                  </form>

                  <form className="admin-form" onSubmit={onAssignRolePermissions}>
                    <h4>Assign Role Permissions</h4>
                    <select
                      value={selectedRoleId === "" ? "" : String(selectedRoleId)}
                      onChange={(e) => setSelectedRoleId(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Select role</option>
                      {rbac.roles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                    <input value={selectedRolePermissions} onChange={(e) => setSelectedRolePermissions(e.target.value)} placeholder="Permissions comma separated" />
                    <button type="submit">Apply Permissions</button>
                  </form>
                </div>

                <div className="admin-table-wrap">
                  <h4>Users and Roles</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Roles</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rbac.users.map((user) => (
                        <tr key={user.id}>
                          <td>{user.email}</td>
                          <td>{user.fullName}</td>
                          <td>{user.roles.join(", ") || "-"}</td>
                          <td>{user.isActive ? "Active" : "Inactive"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-table-wrap">
                  <h4>Roles and Permissions</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Permissions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rbac.roles.map((role) => (
                        <tr key={role.id}>
                          <td>{role.name}</td>
                          <td>{role.permissions.join(", ") || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-table-wrap">
                  <h4>Audit Trail</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Metadata</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditItems.map((item) => (
                        <tr key={item.id}>
                          <td>{new Date(item.createdAt).toLocaleString()}</td>
                          <td>{item.actorEmail ?? "Unknown"}</td>
                          <td>{item.action}</td>
                          <td>{item.targetType}:{item.targetId ?? "-"}</td>
                          <td><pre className="audit-json">{JSON.stringify(item.metadata)}</pre></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-table-wrap">
                  <h4>Automation Control</h4>
                  <p className="admin-note">{automationStatus}</p>
                  <div className="health-link-row">
                    <button type="button" onClick={() => openHealth("/health")}>Open /health</button>
                    <button type="button" onClick={() => openHealth("/health/startup")}>Open /health/startup</button>
                    <button type="button" onClick={() => openHealth("/health/ui")}>Open /health/ui</button>
                  </div>
                  <button type="button" onClick={onRunWeeklyReport}>Run Weekly GM Report Now</button>

                  <table>
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyRuns.map((run, index) => (
                        <tr key={index}>
                          <td>{String(run.startedAt ?? "-")}</td>
                          <td>{String(run.status ?? "-")}</td>
                          <td><pre className="audit-json">{JSON.stringify(run.details ?? {})}</pre></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-grid">
                  <form className="admin-form" onSubmit={onCreateFaultRule}>
                    <h4>Create Fault Notification Rule</h4>
                    <input value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} placeholder="Rule name" />
                    <input type="number" value={newRuleThreshold} onChange={(e) => setNewRuleThreshold(Number(e.target.value))} placeholder="Threshold" />
                    <input type="number" value={newRuleWindowHours} onChange={(e) => setNewRuleWindowHours(Number(e.target.value))} placeholder="Window hours" />
                    <select value={newRuleChannel} onChange={(e) => setNewRuleChannel(e.target.value as FaultChannel)}>
                      <option value="email">email</option>
                      <option value="teams_webhook">teams_webhook</option>
                      <option value="whatsapp_webhook">whatsapp_webhook</option>
                    </select>
                    <input
                      value={newRuleRecipient}
                      onChange={(e) => setNewRuleRecipient(e.target.value)}
                      placeholder={newRuleChannel === "email" ? "Email recipient" : "Webhook URL"}
                    />
                    <button type="submit">Create Rule</button>
                  </form>

                  <form className="admin-form" onSubmit={onUpdateFaultRule}>
                    <h4>Edit or Disable Fault Rule</h4>
                    <select
                      value={selectedFaultRuleId === "" ? "" : String(selectedFaultRuleId)}
                      onChange={(e) => setSelectedFaultRuleId(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Select rule</option>
                      {faultRules.map((rule, index) => (
                        <option key={index} value={String(rule.id)}>{String(rule.name ?? "-")}</option>
                      ))}
                    </select>
                    <input value={editRuleName} onChange={(e) => setEditRuleName(e.target.value)} placeholder="Rule name" />
                    <input type="number" value={editRuleThreshold} onChange={(e) => setEditRuleThreshold(Number(e.target.value))} placeholder="Threshold" />
                    <input type="number" value={editRuleWindowHours} onChange={(e) => setEditRuleWindowHours(Number(e.target.value))} placeholder="Window hours" />
                    <select value={editRuleChannel} onChange={(e) => setEditRuleChannel(e.target.value as FaultChannel)}>
                      <option value="email">email</option>
                      <option value="teams_webhook">teams_webhook</option>
                      <option value="whatsapp_webhook">whatsapp_webhook</option>
                    </select>
                    <input
                      value={editRuleRecipient}
                      onChange={(e) => setEditRuleRecipient(e.target.value)}
                      placeholder={editRuleChannel === "email" ? "Email recipient" : "Webhook URL"}
                    />
                    <label className="toggle-row">
                      <input type="checkbox" checked={editRuleEnabled} onChange={(e) => setEditRuleEnabled(e.target.checked)} />
                      Enabled
                    </label>
                    <button type="submit">Update Rule</button>
                    <button type="button" onClick={onDisableFaultRule}>Disable Rule</button>
                    <button type="button" onClick={onDeleteFaultRule}>Delete Rule</button>
                  </form>

                  <form className="admin-form" onSubmit={onSubmitFaultEvent}>
                    <h4>Log Fault Event</h4>
                    <input value={faultMachineCode} onChange={(e) => setFaultMachineCode(e.target.value)} placeholder="Machine code" />
                    <input value={faultCode} onChange={(e) => setFaultCode(e.target.value)} placeholder="Fault code" />
                    <select value={faultSeverity} onChange={(e) => setFaultSeverity(e.target.value as "low" | "warning" | "high" | "critical")}>
                      <option value="low">low</option>
                      <option value="warning">warning</option>
                      <option value="high">high</option>
                      <option value="critical">critical</option>
                    </select>
                    <input value={faultNotes} onChange={(e) => setFaultNotes(e.target.value)} placeholder="Notes" />
                    <button type="submit">Submit Fault Event</button>
                  </form>
                </div>

                <div className="admin-table-wrap">
                  <h4>Fault Rules</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Enabled</th>
                        <th>Channel</th>
                        <th>Threshold</th>
                        <th>Window</th>
                        <th>Recipient</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faultRules.map((rule, index) => (
                        <tr key={index}>
                          <td>{String(rule.name ?? "-")}</td>
                          <td>{String(rule.enabled ?? false)}</td>
                          <td>{String(rule.channel ?? "-")}</td>
                          <td>{String(rule.occurrenceThreshold ?? "-")}</td>
                          <td>{String(rule.windowHours ?? "-")}h</td>
                          <td>{String(rule.recipient ?? "-")}</td>
                          <td>
                            <button type="button" onClick={() => setSelectedFaultRuleId(Number(rule.id))}>Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-table-wrap">
                  <h4>Triggered Fault Notifications</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Machine</th>
                        <th>Fault</th>
                        <th>Occurrences</th>
                        <th>Rule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faultNotifications.map((item, index) => (
                        <tr key={index}>
                          <td>{String(item.createdAt ?? "-")}</td>
                          <td>{String(item.machineCode ?? "-")}</td>
                          <td>{String(item.faultCode ?? "-")}</td>
                          <td>{String(item.occurrenceCount ?? "-")}</td>
                          <td>{String(item.ruleName ?? "-")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-table-wrap">
                  <h4>Mass Import</h4>
                  <p className="admin-note">Paste CSV with header row and run import per dataset.</p>
                  <p className="admin-note">{importStatus}</p>

                  <div className="admin-grid">
                    <div className="admin-form">
                      <h4>Assets Import</h4>
                      <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropFile("assets", e)}>
                        Drop CSV/XLSX here
                      </div>
                      {parserLoadingEntity === "assets" && <p className="loading-note">Loading spreadsheet parser...</p>}
                      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => onFileChange("assets", e)} />
                      <textarea value={assetsCsv} onChange={(e) => setAssetsCsv(e.target.value)} rows={6} />
                      <button type="button" onClick={() => handleImport("assets", assetsCsv)}>Import Assets</button>
                    </div>

                    <div className="admin-form">
                      <h4>Fuel Import</h4>
                      <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropFile("fuel", e)}>
                        Drop CSV/XLSX here
                      </div>
                      {parserLoadingEntity === "fuel" && <p className="loading-note">Loading spreadsheet parser...</p>}
                      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => onFileChange("fuel", e)} />
                      <textarea value={fuelCsv} onChange={(e) => setFuelCsv(e.target.value)} rows={6} />
                      <button type="button" onClick={() => handleImport("fuel", fuelCsv)}>Import Fuel</button>
                    </div>

                    <div className="admin-form">
                      <h4>Stores Import</h4>
                      <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropFile("stores", e)}>
                        Drop CSV/XLSX here
                      </div>
                      {parserLoadingEntity === "stores" && <p className="loading-note">Loading spreadsheet parser...</p>}
                      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => onFileChange("stores", e)} />
                      <textarea value={storesCsv} onChange={(e) => setStoresCsv(e.target.value)} rows={6} />
                      <button type="button" onClick={() => handleImport("stores", storesCsv)}>Import Stores</button>
                    </div>

                    <div className="admin-form">
                      <h4>Hours Import</h4>
                      <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropFile("hours", e)}>
                        Drop CSV/XLSX here
                      </div>
                      {parserLoadingEntity === "hours" && <p className="loading-note">Loading spreadsheet parser...</p>}
                      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => onFileChange("hours", e)} />
                      <textarea value={hoursCsv} onChange={(e) => setHoursCsv(e.target.value)} rows={6} />
                      <button type="button" onClick={() => handleImport("hours", hoursCsv)}>Import Hours</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
          )}
        </>
      )}
    </main>
  );
}
