import cors from "cors";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { config, validateSecurityConfig } from "./config.js";
import { requireAuth, requirePermission } from "./middleware/auth.js";
import { requestTelemetry } from "./middleware/requestTelemetry.js";
import { PERMISSIONS } from "./permissions.js";
import { adminImportsRouter } from "./routes/adminImports.js";
import { adminAutomationRouter } from "./routes/adminAutomation.js";
import { adminRbacRouter } from "./routes/adminRbac.js";
import { authRouter } from "./routes/auth.js";
import { enterpriseRouter } from "./routes/enterprise.js";
import { hseRouter } from "./routes/hse.js";
import { hrRouter } from "./routes/hr.js";
import { ironmindRouter } from "./routes/ironmind.js";
import { logisticsRouter } from "./routes/logistics.js";
import { operationsRouter } from "./routes/operations.js";
import { plantRouter } from "./routes/plant.js";
import { qualityRouter } from "./routes/quality.js";
import { sitesRouter } from "./routes/sites.js";
import { workOrdersRouter } from "./routes/workOrders.js";
import { realtimeHub } from "./services/realtimeHub.js";
import { startSchedulers } from "./services/schedulerService.js";
import { getStartupHealth } from "./services/startupHealthService.js";
import { verifyAccessToken } from "./services/tokenService.js";

const app = express();
const httpServer = createServer(app);

validateSecurityConfig();

app.use(cors());
app.use(express.json());
app.use(requestTelemetry);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ironlog-api" });
});

app.get("/health/startup", async (_req, res) => {
  const startupHealth = await getStartupHealth();
  const code = startupHealth.status === "ok" ? 200 : 503;
  res.status(code).json(startupHealth);
});

app.get("/health/ui", async (_req, res) => {
  const startupHealth = await getStartupHealth();
  const statusColor = startupHealth.status === "ok" ? "#22c55e" : "#ef4444";
  const dbColor = startupHealth.dependencies.database.status === "ok" ? "#22c55e" : "#ef4444";
  const redisColor = startupHealth.dependencies.redis.status === "ok" ? "#22c55e" : "#ef4444";

  res
    .status(startupHealth.status === "ok" ? 200 : 503)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>IRONLOG Health</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; background: #0b1220; color: #e5e7eb; }
      .card { max-width: 760px; margin: 0 auto; background: #111827; border: 1px solid #334155; border-radius: 14px; padding: 20px; }
      h1 { margin-top: 0; }
      .row { display: flex; gap: 12px; align-items: center; margin: 10px 0; }
      .dot { width: 12px; height: 12px; border-radius: 999px; display: inline-block; }
      code { background: #0f172a; padding: 2px 6px; border-radius: 6px; }
      .muted { color: #94a3b8; font-size: 13px; }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>IRONLOG Startup Health</h1>
      <div class="row"><span class="dot" style="background:${statusColor}"></span><strong>Overall: ${startupHealth.status}</strong></div>
      <div class="row"><span class="dot" style="background:${dbColor}"></span>Database: ${startupHealth.dependencies.database.status} <span class="muted">(${startupHealth.dependencies.database.latencyMs} ms)</span></div>
      <div class="row"><span class="dot" style="background:${redisColor}"></span>Redis: ${startupHealth.dependencies.redis.status} <span class="muted">(${startupHealth.dependencies.redis.latencyMs} ms)</span></div>
      <p>DB message: <code>${startupHealth.dependencies.database.message}</code></p>
      <p>Redis message: <code>${startupHealth.dependencies.redis.message}</code></p>
      <p class="muted">Checked at ${startupHealth.checkedAt}</p>
    </section>
  </body>
</html>`);
});

app.use("/api/auth", authRouter);
app.use("/api/admin/rbac", requireAuth, requirePermission(PERMISSIONS.systemAdmin), adminRbacRouter);
app.use("/api/admin/import", requireAuth, requirePermission(PERMISSIONS.systemAdmin), adminImportsRouter);
app.use("/api/admin/automation", requireAuth, requirePermission(PERMISSIONS.systemAdmin), adminAutomationRouter);
app.use("/api/enterprise", requireAuth, enterpriseRouter);
app.use("/api/sites", requireAuth, sitesRouter);
app.use("/api/work-orders", requireAuth, workOrdersRouter);

app.use("/api/plant", requireAuth, requirePermission(PERMISSIONS.plantRead), plantRouter);
app.use("/api/operations", requireAuth, requirePermission(PERMISSIONS.operationsRead), operationsRouter);
app.use("/api/hse", requireAuth, requirePermission(PERMISSIONS.hseRead), hseRouter);
app.use("/api/hr", requireAuth, requirePermission(PERMISSIONS.hrRead), hrRouter);
app.use("/api/quality", requireAuth, requirePermission(PERMISSIONS.qualityRead), qualityRouter);
app.use("/api/logistics", requireAuth, requirePermission(PERMISSIONS.logisticsRead), logisticsRouter);
app.use("/api/ironmind", requireAuth, requirePermission(PERMISSIONS.ironmindRead), ironmindRouter);

const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/ws/ironmind"
});

wsServer.on("connection", (socket, request) => {
  const requestUrl = new URL(request.url ?? "", `http://${request.headers.host ?? "localhost"}`);
  const token = requestUrl.searchParams.get("token");

  if (!token) {
    socket.close(1008, "Unauthorized: token required");
    return;
  }

  try {
    const user = verifyAccessToken(token);
    const canReadIronmind = user.permissions.includes(PERMISSIONS.ironmindRead) || user.permissions.includes(PERMISSIONS.systemAdmin);
    if (!canReadIronmind) {
      socket.close(1008, "Unauthorized: missing ironmind permission");
      return;
    }
  } catch {
    socket.close(1008, "Unauthorized: invalid token");
    return;
  }

  socket.send(
    JSON.stringify({
      type: "connection_established",
      payload: { ts: new Date().toISOString() }
    })
  );
});

realtimeHub.on("fault_event_created", (payload) => {
  const message = JSON.stringify({ type: "fault_event_created", payload });
  wsServer.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
});

realtimeHub.on("investigation_case_updated", (payload) => {
  const message = JSON.stringify({ type: "investigation_case_updated", payload });
  wsServer.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
});

httpServer.on("error", (error) => {
  console.error("HTTP server failed", error);
});

httpServer.listen(config.port, () => {
  try {
    startSchedulers();
  } catch (error) {
    console.error("Scheduler initialization failed", error);
  }
  console.log(`IRONLOG API running on port ${config.port}`);
});
