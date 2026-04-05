const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "ironlog.token";
const REFRESH_TOKEN_KEY = "ironlog.refreshToken";
export const AUTH_SESSION_EXPIRED_EVENT = "ironlog:session-expired";

let refreshInFlight: Promise<string | null> | null = null;

function setAuthTokens(tokens: { token?: string; refreshToken?: string }) {
  if (tokens.token) {
    localStorage.setItem(TOKEN_KEY, tokens.token);
  }

  if (tokens.refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
}

function clearAuthTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function notifySessionExpired() {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    clearAuthTokens();
    notifySessionExpired();
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        clearAuthTokens();
        notifySessionExpired();
        return null;
      }

      const payload = await response.json();
      setAuthTokens({ token: payload?.token, refreshToken: payload?.refreshToken });
      return payload?.token ?? null;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

function shouldSkipRefresh(path: string) {
  return path.startsWith("/auth/login") || path.startsWith("/auth/refresh");
}

async function authFetch(path: string, init?: RequestInit, hasRetried = false): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (response.status === 401 && !hasRetried && !shouldSkipRefresh(path)) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      return authFetch(path, init, true);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed for ${path}`);
  }

  return response;
}

export type PlantKpiResponse = {
  maintenance: {
    mtbf: number;
    mttr: number;
    breakdownCount: number;
  };
  availability: Array<{
    id: string;
    name: string;
    availability: number;
    utilization: number;
    fuelLiters: number;
  }>;
};

export type RbacSummary = {
  users: Array<{
    id: string;
    email: string;
    fullName: string;
    isActive: boolean;
    roles: string[];
  }>;
  roles: Array<{
    id: number;
    name: string;
    permissions: string[];
  }>;
  permissions: Array<{
    id: number;
    name: string;
  }>;
};

export type RbacAuditItem = {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorEmail: string | null;
};

export async function login(email: string, password: string) {
  const response = await authFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json();
  setAuthTokens({ token: payload?.token, refreshToken: payload?.refreshToken });

  return payload;
}

export function hasToken() {
  return Boolean(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(REFRESH_TOKEN_KEY));
}

export async function getPlantKpis(): Promise<PlantKpiResponse> {
  const response = await authFetch("/plant/kpis");
  return response.json();
}

export async function getOperationsDashboard() {
  const response = await authFetch("/operations/dashboard");
  return response.json();
}

export async function getModuleSummary(module: string, endpoint = "summary") {
  const response = await authFetch(`/${module}/${endpoint}`);
  return response.json();
}

export async function getOperationsDump() {
  const response = await authFetch("/operations/dump");
  return response.json();
}

export async function getHseDump() {
  const response = await authFetch("/hse/dump");
  return response.json();
}

export async function getHrDump() {
  const response = await authFetch("/hr/dump");
  return response.json();
}

export async function getQualityDump() {
  const response = await authFetch("/quality/dump");
  return response.json();
}

export async function getLogisticsDump() {
  const response = await authFetch("/logistics/dump");
  return response.json();
}

export async function getEnterpriseOverview(hours = 24 * 7) {
  const response = await authFetch(`/enterprise/overview?hours=${hours}`);
  return response.json();
}

export async function getEnterpriseOverviewBySite(hours = 24 * 7, siteCode = "SITE-A") {
  const response = await authFetch(`/enterprise/overview?hours=${hours}&siteCode=${encodeURIComponent(siteCode)}`);
  return response.json();
}

export async function getEnterpriseTrends(hours = 24 * 7, siteCode = "SITE-A", bucketHours = 24) {
  const response = await authFetch(
    `/enterprise/trends?hours=${hours}&siteCode=${encodeURIComponent(siteCode)}&bucketHours=${bucketHours}`
  );
  return response.json();
}

export async function getCrossSiteComparison(hours = 24 * 7) {
  const response = await authFetch(`/enterprise/cross-site-comparison?hours=${hours}`);
  return response.json();
}

export async function getEnterpriseExportBundle(hours = 24 * 7, siteCode = "SITE-A") {
  const response = await authFetch(`/enterprise/export-bundle?hours=${hours}&siteCode=${encodeURIComponent(siteCode)}`);
  return response.json();
}

export async function persistEnterpriseExportBundle(hours = 24 * 7, siteCode = "SITE-A") {
  const response = await authFetch("/enterprise/export-bundle/persist", {
    method: "POST",
    body: JSON.stringify({ hours, siteCode })
  });
  return response.json();
}

export async function getEnterpriseExportArtifacts(siteCode = "SITE-A") {
  const response = await authFetch(`/enterprise/export-artifacts?siteCode=${encodeURIComponent(siteCode)}`);
  return response.json();
}

export async function createEnterpriseArtifactToken(artifactId: number) {
  const response = await authFetch(`/enterprise/export-artifacts/${artifactId}/token`, {
    method: "POST"
  });
  return response.json();
}

export async function runEnterpriseSyntheticLoad(payload: {
  days: number;
  machines: string[];
  eventsPerDayPerMachine: number;
  includeCriticalSpike: boolean;
  siteCode?: string;
  scenarioTemplate?: "normal" | "stress" | "incident_surge";
}) {
  const response = await authFetch("/enterprise/synthetic-load", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getEnterpriseSyntheticLoadRuns() {
  const response = await authFetch("/enterprise/synthetic-load/runs");
  return response.json();
}

export async function getEnterpriseSyntheticLoadRunsBySite(siteCode = "SITE-A") {
  const response = await authFetch(`/enterprise/synthetic-load/runs?siteCode=${encodeURIComponent(siteCode)}`);
  return response.json();
}

export async function getSites() {
  const response = await authFetch("/sites");
  return response.json();
}

export async function getSiteContext(siteCode: string) {
  const response = await authFetch(`/sites/${encodeURIComponent(siteCode)}/context`);
  return response.json();
}

export async function createSite(payload: { siteCode: string; name: string; region?: string; isActive?: boolean }) {
  const response = await authFetch("/sites", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function grantSiteAccess(siteId: number, payload: { userId: string; role: "viewer" | "operator" | "manager" | "admin" }) {
  const response = await authFetch(`/sites/${siteId}/access`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getRbacSummary(): Promise<RbacSummary> {
  const response = await authFetch("/admin/rbac/summary");
  return response.json();
}

export async function createRbacUser(payload: {
  email: string;
  fullName: string;
  password: string;
  roleNames: string[];
}) {
  const response = await authFetch("/admin/rbac/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function createRbacRole(payload: {
  name: string;
  permissionNames: string[];
}) {
  const response = await authFetch("/admin/rbac/roles", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function assignUserRoles(userId: string, roleNames: string[]) {
  const response = await authFetch(`/admin/rbac/users/${userId}/roles`, {
    method: "POST",
    body: JSON.stringify({ roleNames })
  });
  return response.json();
}

export async function assignRolePermissions(roleId: number, permissionNames: string[]) {
  const response = await authFetch(`/admin/rbac/roles/${roleId}/permissions`, {
    method: "POST",
    body: JSON.stringify({ permissionNames })
  });
  return response.json();
}

export async function getRbacAudit(limit = 50): Promise<{ items: RbacAuditItem[] }> {
  const response = await authFetch(`/admin/rbac/audit?limit=${limit}`);
  return response.json();
}

type ImportEntity = "assets" | "fuel" | "stores" | "hours";

export async function importCsv(entity: ImportEntity, csv: string) {
  const response = await authFetch(`/admin/import/${entity}`, {
    method: "POST",
    body: JSON.stringify({ csv })
  });
  return response.json();
}

export async function importRows(entity: ImportEntity, rows: Array<Record<string, unknown>>) {
  const response = await authFetch(`/admin/import/${entity}`, {
    method: "POST",
    body: JSON.stringify({ rows })
  });
  return response.json();
}

export async function runWeeklyGmReport() {
  const response = await authFetch("/admin/automation/weekly-gm/run", {
    method: "POST"
  });
  return response.json();
}

export async function getWeeklyGmRuns() {
  const response = await authFetch("/admin/automation/weekly-gm/runs");
  return response.json();
}

export async function getFaultRules() {
  const response = await authFetch("/admin/automation/fault-rules");
  return response.json();
}

export async function createFaultRule(payload: {
  name: string;
  enabled: boolean;
  occurrenceThreshold: number;
  windowHours: number;
  channel: "email" | "teams_webhook" | "whatsapp_webhook";
  recipient: string;
}) {
  const response = await authFetch("/admin/automation/fault-rules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function updateFaultRule(
  id: number,
  payload: Partial<{
    name: string;
    enabled: boolean;
    occurrenceThreshold: number;
    windowHours: number;
    channel: "email" | "teams_webhook" | "whatsapp_webhook";
    recipient: string;
  }>
) {
  const response = await authFetch(`/admin/automation/fault-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function disableFaultRule(id: number) {
  const response = await authFetch(`/admin/automation/fault-rules/${id}/disable`, {
    method: "POST"
  });
  return response.json();
}

export async function deleteFaultRule(id: number) {
  const response = await authFetch(`/admin/automation/fault-rules/${id}`, {
    method: "DELETE"
  });
  return response.json();
}

export async function createFaultEvent(payload: {
  machineCode: string;
  faultCode: string;
  severity: "low" | "warning" | "high" | "critical";
  notes?: string;
  occurredAt?: string;
}) {
  const response = await authFetch("/ironmind/faults/events", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getFaultNotifications() {
  const response = await authFetch("/ironmind/faults/notifications");
  return response.json();
}

export async function getIronmindIntelOverview(hours = 24 * 7) {
  const response = await authFetch(`/ironmind/intel/overview?hours=${hours}`);
  return response.json();
}

export async function getIronmindIntelTimeline(machineCode?: string, limit = 60) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (machineCode && machineCode.trim().length > 0) {
    params.set("machineCode", machineCode.trim());
  }

  const response = await authFetch(`/ironmind/intel/timeline?${params.toString()}`);
  return response.json();
}

export async function getIronmindRecommendations(hours = 24 * 7) {
  const response = await authFetch(`/ironmind/intel/recommendations?hours=${hours}`);
  return response.json();
}

export async function runIronmindWhatIf(payload: {
  machineCode: string;
  faultCode: string;
  incomingEvents: number;
  windowHours: number;
}) {
  const response = await authFetch("/ironmind/intel/what-if", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getIronmindPredictive(horizonHours = 72, windowHours = 24 * 14) {
  const response = await authFetch(`/ironmind/intel/predictive?horizonHours=${horizonHours}&windowHours=${windowHours}`);
  return response.json();
}

export async function getInvestigationCases(limit = 50, status?: "open" | "investigating" | "monitoring" | "closed") {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (status) {
    params.set("status", status);
  }
  const response = await authFetch(`/ironmind/cases?${params.toString()}`);
  return response.json();
}

export async function createInvestigationCase(payload: {
  machineCode: string;
  faultCode: string;
  severity: "low" | "warning" | "high" | "critical";
  title: string;
  description?: string;
  ownerName?: string;
}) {
  const response = await authFetch("/ironmind/cases", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function addCaseAction(
  caseId: number,
  payload: { actionTitle: string; ownerName?: string; dueAt?: string; notes?: string }
) {
  const response = await authFetch(`/ironmind/cases/${caseId}/actions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function closeInvestigationCase(caseId: number, closureSummary?: string) {
  const response = await authFetch(`/ironmind/cases/${caseId}/close`, {
    method: "POST",
    body: JSON.stringify({ closureSummary })
  });
  return response.json();
}

type IronmindStreamMessage = {
  type: string;
  payload: Record<string, unknown>;
};

export function subscribeIronmindStream(onMessage: (message: IronmindStreamMessage) => void) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    throw new Error("No access token available for realtime stream");
  }

  const apiOrigin = API_BASE.replace(/\/api\/?$/, "");
  const wsBase = apiOrigin.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ws/ironmind?token=${encodeURIComponent(token)}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as IronmindStreamMessage;
      onMessage(data);
    } catch {
      // Ignore malformed messages.
    }
  };

  return () => {
    ws.close();
  };
}

export async function saveOperatorEntry(payload: {
  entryDate: string;
  machineCode: string;
  shiftName: string;
  operatorName: string;
  hoursRun: number;
  hoursAvailable: number;
  fuelLiters?: number;
}) {
  const response = await authFetch("/plant/operator-entries", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getOperatorEntries(limit = 20) {
  const response = await authFetch(`/plant/operator-entries?limit=${limit}`);
  return response.json();
}

export async function getWorkOrders(siteCode = "SITE-A", status?: "open" | "assigned" | "in_progress" | "blocked" | "pending_approval" | "approved" | "closed") {
  const params = new URLSearchParams();
  params.set("siteCode", siteCode);
  params.set("limit", "120");
  if (status) {
    params.set("status", status);
  }
  const response = await authFetch(`/work-orders?${params.toString()}`);
  return response.json();
}

export async function getWorkOrderWorkflowBoard(siteCode = "SITE-A", limit = 200) {
  const response = await authFetch(`/work-orders/workflow/board?siteCode=${encodeURIComponent(siteCode)}&limit=${limit}`);
  return response.json();
}

export async function createWorkOrder(payload: {
  siteCode: string;
  department: string;
  machineCode?: string;
  faultCode?: string;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "critical";
  assignedToName?: string;
  dueAt?: string;
  estimatedCost: number;
  downtimeHours: number;
}) {
  const response = await authFetch("/work-orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function updateWorkOrder(id: number, payload: Partial<{
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "assigned" | "in_progress" | "blocked" | "pending_approval" | "approved" | "closed";
  assignedToName: string;
  dueAt: string | null;
  actualCost: number;
  downtimeHours: number;
  evidenceNotes: string;
}>) {
  const response = await authFetch(`/work-orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function requestWorkOrderApproval(id: number, reason?: string) {
  const response = await authFetch(`/work-orders/${id}/request-approval`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
  return response.json();
}

export async function approveWorkOrder(id: number, notes?: string) {
  const response = await authFetch(`/work-orders/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes })
  });
  return response.json();
}

export async function closeWorkOrder(id: number, payload: {
  actualCost?: number;
  downtimeHours?: number;
  evidenceNotes?: string;
}) {
  const response = await authFetch(`/work-orders/${id}/close`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getWorkOrderShiftBoard(siteCode = "SITE-A") {
  const response = await authFetch(`/work-orders/board/shift?siteCode=${encodeURIComponent(siteCode)}`);
  return response.json();
}

export async function getWorkOrderAttribution(siteCode = "SITE-A", hours = 24 * 7) {
  const response = await authFetch(`/work-orders/attribution/cost-downtime?siteCode=${encodeURIComponent(siteCode)}&hours=${hours}`);
  return response.json();
}

export async function getWorkOrderScorecard(siteCode = "SITE-A", days = 30) {
  const response = await authFetch(`/work-orders/scorecard/role?siteCode=${encodeURIComponent(siteCode)}&days=${days}`);
  return response.json();
}

export async function getWorkOrderSlaRules(siteCode = "SITE-A") {
  const response = await authFetch(`/work-orders/sla-rules?siteCode=${encodeURIComponent(siteCode)}`);
  return response.json();
}

export async function createWorkOrderSlaRule(payload: {
  siteCode: string;
  name: string;
  enabled: boolean;
  appliesPriority?: "low" | "medium" | "high" | "critical";
  appliesDepartment?: string;
  breachAfterHours: number;
  escalationChannel: "email" | "teams_webhook" | "whatsapp_webhook";
  escalationRecipient: string;
  autoRequestApproval: boolean;
}) {
  const response = await authFetch("/work-orders/sla-rules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function updateWorkOrderSlaRule(
  id: number,
  payload: Partial<{
    siteCode: string;
    name: string;
    enabled: boolean;
    appliesPriority: "low" | "medium" | "high" | "critical";
    appliesDepartment: string;
    breachAfterHours: number;
    escalationChannel: "email" | "teams_webhook" | "whatsapp_webhook";
    escalationRecipient: string;
    autoRequestApproval: boolean;
  }>
) {
  const response = await authFetch(`/work-orders/sla-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function runWorkOrderSlaEvaluation(siteCode?: string) {
  const response = await authFetch("/work-orders/sla-evaluate/run", {
    method: "POST",
    body: JSON.stringify(siteCode ? { siteCode } : {})
  });
  return response.json();
}

export async function getWorkOrderEscalations(siteCode = "SITE-A") {
  const response = await authFetch(`/work-orders/escalations?siteCode=${encodeURIComponent(siteCode)}&limit=100`);
  return response.json();
}

export async function retryWorkOrderEscalationsNow() {
  const response = await authFetch("/work-orders/escalations/retry-run", {
    method: "POST"
  });
  return response.json();
}

export async function uploadWorkOrderAttachment(
  id: number,
  payload: { fileName: string; mimeType: string; contentBase64: string; notes?: string }
) {
  const response = await authFetch(`/work-orders/${id}/attachments`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function getWorkOrderAttachments(id: number) {
  const response = await authFetch(`/work-orders/${id}/attachments`);
  return response.json();
}

export async function getWorkOrderChecklist(id: number) {
  const response = await authFetch(`/work-orders/${id}/checklist`);
  return response.json();
}

export async function createWorkOrderChecklistItem(id: number, payload: { title: string; assigneeName?: string; dueAt?: string }) {
  const response = await authFetch(`/work-orders/${id}/checklist`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function updateWorkOrderChecklistItemStatus(id: number, itemId: number, status: "todo" | "done") {
  const response = await authFetch(`/work-orders/${id}/checklist/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return response.json();
}

export async function getWorkOrderComments(id: number, limit = 100) {
  const response = await authFetch(`/work-orders/${id}/comments?limit=${limit}`);
  return response.json();
}

export async function createWorkOrderComment(id: number, message: string) {
  const response = await authFetch(`/work-orders/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ message })
  });
  return response.json();
}

export async function getWorkOrderDependencies(id: number) {
  const response = await authFetch(`/work-orders/${id}/dependencies`);
  return response.json();
}

export async function addWorkOrderDependency(id: number, dependsOnWorkOrderId: number) {
  const response = await authFetch(`/work-orders/${id}/dependencies`, {
    method: "POST",
    body: JSON.stringify({ dependsOnWorkOrderId })
  });
  return response.json();
}

export async function removeWorkOrderDependency(id: number, dependsOnId: number) {
  const response = await authFetch(`/work-orders/${id}/dependencies/${dependsOnId}`, {
    method: "DELETE"
  });
  return response.json();
}

export async function generateExecutiveShiftReportPdf(siteCode = "SITE-A") {
  const response = await authFetch("/work-orders/reports/executive/pdf", {
    method: "POST",
    body: JSON.stringify({ siteCode })
  });
  return response.json();
}

export async function dispatchExecutiveShiftReportNow() {
  const response = await authFetch("/work-orders/reports/executive/pdf/dispatch", {
    method: "POST"
  });
  return response.json();
}
