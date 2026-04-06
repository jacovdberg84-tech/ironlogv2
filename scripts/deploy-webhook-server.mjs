import { appendFile, mkdir } from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const port = Number(process.env.DEPLOY_WEBHOOK_PORT ?? 9000);
const host = process.env.DEPLOY_WEBHOOK_HOST ?? "127.0.0.1";
const webhookToken = process.env.DEPLOY_WEBHOOK_TOKEN ?? "";
const deployCommand =
  process.env.DEPLOY_COMMAND ??
  "cd /opt/ironlogv2 && git pull --ff-only && npm ci && npm --workspace apps/api run build && npm --workspace apps/web run build && pm2 restart ironlog-api && systemctl reload nginx";
const maxBodyBytes = Number(process.env.DEPLOY_WEBHOOK_MAX_BODY_BYTES ?? 1024 * 1024);
const logFile = process.env.DEPLOY_WEBHOOK_LOG_FILE ?? "/var/log/ironlog-deploy-webhook.log";

if (!webhookToken) {
  console.error("DEPLOY_WEBHOOK_TOKEN is required");
  process.exit(1);
}

let runningJob = null;
let latestJob = null;

async function writeLog(line) {
  const stamp = new Date().toISOString();
  const entry = `${stamp} ${line}\n`;
  try {
    await mkdir(logFile.substring(0, logFile.lastIndexOf("/")), { recursive: true });
    await appendFile(logFile, entry, "utf8");
  } catch {
    // Keep service alive even if file logging fails.
  }
  console.log(entry.trim());
}

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBodyBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function runDeployJob(payload) {
  const id = randomUUID();
  const startedAt = new Date().toISOString();

  const job = {
    id,
    startedAt,
    finishedAt: null,
    status: "running",
    payload,
    exitCode: null,
    stdout: "",
    stderr: ""
  };

  runningJob = job;
  latestJob = job;

  const ref = String(payload?.ref ?? "main");
  const environment = String(payload?.environment ?? "staging");

  writeLog(`job=${id} started ref=${ref} env=${environment}`);

  const child = spawn("bash", ["-lc", deployCommand], {
    env: {
      ...process.env,
      DEPLOY_REF: ref,
      DEPLOY_ENVIRONMENT: environment,
      DEPLOY_REQUEST_ID: id
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    job.stdout += chunk.toString("utf8");
  });

  child.stderr.on("data", (chunk) => {
    job.stderr += chunk.toString("utf8");
  });

  child.on("close", async (code) => {
    job.exitCode = code ?? -1;
    job.status = code === 0 ? "success" : "failed";
    job.finishedAt = new Date().toISOString();
    runningJob = null;

    await writeLog(`job=${id} finished status=${job.status} exitCode=${job.exitCode}`);

    if (job.stdout) {
      await writeLog(`job=${id} stdout=${job.stdout.trim().slice(0, 6000)}`);
    }

    if (job.stderr) {
      await writeLog(`job=${id} stderr=${job.stderr.trim().slice(0, 6000)}`);
    }
  });

  child.on("error", async (error) => {
    job.status = "failed";
    job.exitCode = -1;
    job.finishedAt = new Date().toISOString();
    job.stderr += `\nspawn_error: ${error.message}`;
    runningJob = null;
    await writeLog(`job=${id} spawn_error=${error.message}`);
  });

  return job;
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Invalid request" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "deploy-webhook",
      running: Boolean(runningJob),
      latestJob: latestJob
        ? {
            id: latestJob.id,
            status: latestJob.status,
            startedAt: latestJob.startedAt,
            finishedAt: latestJob.finishedAt,
            exitCode: latestJob.exitCode
          }
        : null
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/jobs/latest") {
    if (!latestJob) {
      sendJson(res, 404, { error: "No jobs yet" });
      return;
    }

    sendJson(res, 200, latestJob);
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    const token = getBearerToken(req);
    if (!token || token !== webhookToken) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (runningJob) {
      sendJson(res, 409, {
        error: "Deployment already running",
        runningJob: {
          id: runningJob.id,
          startedAt: runningJob.startedAt,
          status: runningJob.status
        }
      });
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid payload" });
      return;
    }

    const job = runDeployJob(payload);
    sendJson(res, 202, {
      accepted: true,
      jobId: job.id,
      status: job.status,
      startedAt: job.startedAt
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(port, host, async () => {
  await writeLog(`deploy-webhook listening on ${host}:${port}`);
});
