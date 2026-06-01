const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const port = Number(process.env.PORT || 4173);
const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "enftsar-admin";
const storageMode = process.env.STORAGE_MODE || "local";
const root = process.cwd();
const dataRoot = process.env.DATA_DIR || (process.env.VERCEL ? path.join("/tmp", "tollan-offline") : root);
const uploadDir = path.join(dataRoot, "uploads");
const recordingsPath = path.join(uploadDir, "recordings.json");
const bracketPath = path.join(uploadDir, "bracket.json");
const settingsPath = path.join(uploadDir, "settings.json");
const auditPath = path.join(uploadDir, "audit.json");
const sessions = new Map();

const r2Bucket = process.env.R2_BUCKET;
const r2AccountId = process.env.R2_ACCOUNT_ID;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2Endpoint = process.env.R2_ENDPOINT || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : "");
const r2Enabled = storageMode === "r2" && Boolean(r2Bucket && r2Endpoint && r2AccessKeyId && r2SecretAccessKey);
const r2DataPrefix = (process.env.R2_DATA_PREFIX || "_tollan-data").replace(/^\/|\/$/g, "");
const r2VideoPrefix = (process.env.R2_VIDEO_PREFIX || "recordings").replace(/^\/|\/$/g, "");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webm": "video/webm",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let r2Client;

function getR2Client() {
  if (!r2Enabled) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });
  }
  return r2Client;
}

function ensureDataDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(filePath, fallback) {
  if (r2Enabled) {
    try {
      const key = `${r2DataPrefix}/${path.basename(filePath)}`;
      const response = await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      return JSON.parse(await streamToString(response.Body));
    } catch {
      return fallback;
    }
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  if (r2Enabled) {
    const key = `${r2DataPrefix}/${path.basename(filePath)}`;
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: key,
        Body: JSON.stringify(value, null, 2),
        ContentType: "application/json; charset=utf-8",
      }),
    );
    return;
  }

  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function readRecordings() {
  return readJson(recordingsPath, []);
}

async function writeRecordings(recordings) {
  await writeJson(recordingsPath, recordings);
}

function defaultSettings() {
  return {
    bracketLocked: false,
    registrationLocked: false,
    minDurationSeconds: 10,
    tournamentName: "Offline Country Cup",
    storageMode,
    remoteStorageConfigured: r2Enabled || Boolean(process.env.S3_BUCKET),
  };
}

async function readSettings() {
  return { ...defaultSettings(), ...(await readJson(settingsPath, {})) };
}

async function writeSettings(settings) {
  await writeJson(settingsPath, { ...(await readSettings()), ...settings });
}

async function appendAudit(action, details, req) {
  const audit = await readJson(auditPath, []);
  audit.unshift({
    id: crypto.randomUUID(),
    action,
    details,
    ip: req.socket.remoteAddress,
    at: new Date().toISOString(),
    admin: getSession(req)?.user || "system",
  });
  await writeJson(auditPath, audit.slice(0, 500));
}

function defaultBracket() {
  return {
    champion: null,
    rounds: [
      {
        name: "Quarter Finals",
        matches: [
          { id: "qf-1", label: "Match 1", deadline: "", players: [{ name: "Player A", country: "Turkey" }, { name: "Player B", country: "Germany" }], winner: null, nextMatch: "sf-1", nextSlot: 0 },
          { id: "qf-2", label: "Match 2", deadline: "", players: [{ name: "Player C", country: "France" }, { name: "Player D", country: "Italy" }], winner: null, nextMatch: "sf-1", nextSlot: 1 },
          { id: "qf-3", label: "Match 3", deadline: "", players: [{ name: "Player E", country: "Spain" }, { name: "Player F", country: "Poland" }], winner: null, nextMatch: "sf-2", nextSlot: 0 },
          { id: "qf-4", label: "Match 4", deadline: "", players: [{ name: "Player G", country: "United Kingdom" }, { name: "Player H", country: "United States" }], winner: null, nextMatch: "sf-2", nextSlot: 1 },
        ],
      },
      {
        name: "Semi Finals",
        matches: [
          { id: "sf-1", label: "Match 5", deadline: "", players: [{ name: "TBD", country: "Winner Match 1" }, { name: "TBD", country: "Winner Match 2" }], winner: null, nextMatch: "final-1", nextSlot: 0 },
          { id: "sf-2", label: "Match 6", deadline: "", players: [{ name: "TBD", country: "Winner Match 3" }, { name: "TBD", country: "Winner Match 4" }], winner: null, nextMatch: "final-1", nextSlot: 1 },
        ],
      },
      {
        name: "Final",
        matches: [{ id: "final-1", label: "Grand Final", deadline: "", players: [{ name: "TBD", country: "Winner Match 5" }, { name: "TBD", country: "Winner Match 6" }], winner: null, nextMatch: null, nextSlot: null }],
      },
    ],
  };
}

async function readBracket() {
  return readJson(bracketPath, defaultBracket());
}

async function writeBracket(bracket) {
  await writeJson(bracketPath, bracket);
}

function findMatch(bracket, matchId) {
  for (const round of bracket.rounds) {
    const match = round.matches.find((item) => item.id === matchId);
    if (match) return match;
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function getSession(req) {
  const token = parseBearer(req) || req.headers["x-admin-token"];
  if (!token || !sessions.has(token)) return null;
  const session = sessions.get(token);
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return null;
  }
  return session;
}

function publicRecording(item) {
  return {
    recordingId: item.recordingId,
    username: item.username,
    country: item.country,
    status: item.status,
    submittedAt: item.metadata?.submittedAt || item.uploadedAt,
    adminNote: item.publicNote || "",
  };
}

function safeRecordingId(recordingId) {
  return String(recordingId).replace(/[^a-z0-9-]/gi, "_");
}

function videoKeyFor(recordingId) {
  return `${r2VideoPrefix}/${safeRecordingId(recordingId)}.webm`;
}

function makeVideoUrl(recordingId, reviewToken) {
  return `/media/${encodeURIComponent(recordingId)}?token=${encodeURIComponent(reviewToken)}`;
}

async function saveUploadedRecording(body, metadata) {
  ensureDataDir();
  const safeId = safeRecordingId(metadata.recordingId);
  const fileName = `${safeId}.webm`;
  const filePath = path.join(uploadDir, fileName);
  fs.writeFileSync(filePath, body);
  return { fileName, objectKey: fileName, videoUrl: `/uploads/${fileName}`, storage: "local" };
}

function parseJsonBody(buffer) {
  return JSON.parse(buffer.toString("utf8") || "{}");
}

async function buildRecord(metadata, storage) {
  const recordingId = storage.recordingId || metadata.recordingId;
  const reviewToken = storage.reviewToken || crypto.randomBytes(18).toString("hex");
  return {
    ...metadata,
    recordingId,
    ...storage,
    reviewToken,
    reviewUrl: `/review/${reviewToken}`,
    videoUrl: storage.videoUrl || makeVideoUrl(recordingId, reviewToken),
    statusUrl: `/status/${recordingId}`,
    uploadedAt: new Date().toISOString(),
    status: metadata.status || "Pending review",
    publicNote: "",
    adminNote: "",
  };
}

async function validateSubmission(metadata, recordingId, res) {
  const settings = await readSettings();
  if (settings.registrationLocked) {
    sendJson(res, 423, { ok: false, error: "Registration is locked" });
    return false;
  }

  const existing = await readRecordings();
  if (existing.some((item) => item.recordingId === recordingId || item.wallet === metadata.wallet)) {
    sendJson(res, 409, { ok: false, error: "Duplicate recording or wallet" });
    return false;
  }

  const durationSeconds = Number(metadata.metadata?.durationSeconds || 0);
  if (durationSeconds < settings.minDurationSeconds) {
    sendJson(res, 422, { ok: false, error: "Recording is shorter than the minimum duration" });
    return false;
  }

  return true;
}

async function handleR2Init(req, res) {
  if (!r2Enabled) {
    sendJson(res, 400, { ok: false, error: "R2 is not configured" });
    return;
  }

  const payload = parseJsonBody(await readBody(req));
  const metadata = payload.metadata || {};
  const recordingId = metadata.recordingId || `recording-${Date.now()}`;
  if (!(await validateSubmission(metadata, recordingId, res))) return;

  const objectKey = videoKeyFor(recordingId);
  const uploadUrl = await getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: objectKey,
      ContentType: "video/webm",
    }),
    { expiresIn: 900 },
  );

  sendJson(res, 200, { ok: true, storageMode: "r2", uploadUrl, objectKey, recordingId });
}

async function handleR2Complete(req, res) {
  if (!r2Enabled) {
    sendJson(res, 400, { ok: false, error: "R2 is not configured" });
    return;
  }

  const payload = parseJsonBody(await readBody(req));
  const metadata = payload.metadata || {};
  const recordingId = metadata.recordingId || payload.recordingId;
  const objectKey = payload.objectKey;
  if (!objectKey || objectKey !== videoKeyFor(recordingId)) {
    sendJson(res, 400, { ok: false, error: "Invalid upload object" });
    return;
  }
  if (!(await validateSubmission(metadata, recordingId, res))) return;

  try {
    const head = await getR2Client().send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectKey }));
    const existing = await readRecordings();
    const record = await buildRecord(metadata, {
      recordingId,
      objectKey,
      fileName: path.basename(objectKey),
      storage: "r2",
      sizeMb: metadata.sizeMb || ((Number(head.ContentLength || 0) / 1024 / 1024).toFixed(2)),
    });
    existing.unshift(record);
    await writeRecordings(existing);
    await appendAudit("recording.uploaded", { recordingId, username: metadata.username, storage: "r2" }, req);
    sendJson(res, 200, { ok: true, recordingId, reviewUrl: record.reviewUrl, statusUrl: record.statusUrl, videoUrl: record.videoUrl });
  } catch {
    sendJson(res, 422, { ok: false, error: "Uploaded video was not found in R2" });
  }
}

async function handleMedia(req, res, recordingId, url) {
  const recordings = await readRecordings();
  const item = recordings.find((recording) => recording.recordingId === recordingId);
  if (!item) {
    sendJson(res, 404, { ok: false, error: "Recording not found" });
    return;
  }

  const token = url.searchParams.get("token") || "";
  if (token !== item.reviewToken && !getSession(req)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }

  if (item.storage === "r2") {
    try {
      const range = req.headers.range;
      const response = await getR2Client().send(new GetObjectCommand({ Bucket: r2Bucket, Key: item.objectKey, Range: range }));
      const headers = {
        "Content-Type": response.ContentType || "video/webm",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      };
      if (response.ContentLength) headers["Content-Length"] = String(response.ContentLength);
      if (response.ContentRange) headers["Content-Range"] = response.ContentRange;
      res.writeHead(range ? 206 : 200, headers);
      response.Body.pipe(res);
    } catch {
      sendJson(res, 404, { ok: false, error: "Video not found" });
    }
    return;
  }

  const localFile = path.join(uploadDir, item.fileName || "");
  if (!localFile.startsWith(uploadDir) || !fs.existsSync(localFile)) {
    sendJson(res, 404, { ok: false, error: "Video not found" });
    return;
  }
  res.writeHead(200, { "Content-Type": "video/webm", "Cache-Control": "private, no-store" });
  fs.createReadStream(localFile).pipe(res);
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/admin-login") {
    const body = parseJsonBody(await readBody(req));
    if (body.username !== adminUser || body.password !== adminPassword) {
      sendJson(res, 401, { ok: false, error: "Invalid credentials" });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { user: body.username, expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
    await appendAudit("admin.login", { user: body.username }, req);
    sendJson(res, 200, { ok: true, token, user: body.username });
    return;
  }

  if (req.method === "GET" && url.pathname === "/settings") {
    sendJson(res, 200, { ok: true, settings: await readSettings() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/upload/init") {
    await handleR2Init(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/upload/complete") {
    await handleR2Complete(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/upload") {
    const rawMeta = req.headers["x-recording-metadata"];
    const metadata = rawMeta ? JSON.parse(decodeURIComponent(rawMeta)) : {};
    const recordingId = req.headers["x-recording-id"] || metadata.recordingId || `recording-${Date.now()}`;
    if (!(await validateSubmission(metadata, recordingId, res))) return;

    const body = await readBody(req);
    if (!body.length) {
      sendJson(res, 422, { ok: false, error: "Video file is empty or corrupted" });
      return;
    }

    const storage = await saveUploadedRecording(body, { ...metadata, recordingId });
    const existing = await readRecordings();
    const record = await buildRecord(metadata, { ...storage, recordingId });
    record.ip = req.socket.remoteAddress;
    existing.unshift(record);
    await writeRecordings(existing);
    await appendAudit("recording.uploaded", { recordingId, username: metadata.username, storage: "local" }, req);
    sendJson(res, 200, { ok: true, ...storage, recordingId, reviewUrl: record.reviewUrl, statusUrl: record.statusUrl });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    await handleMedia(req, res, decodeURIComponent(url.pathname.split("/").pop()), url);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    const recordingId = decodeURIComponent(url.pathname.split("/").pop());
    const item = (await readRecordings()).find((recording) => recording.recordingId === recordingId);
    if (!item) {
      sendJson(res, 404, { ok: false, error: "Recording not found" });
      return;
    }
    sendJson(res, 200, { ok: true, recording: publicRecording(item) });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/review/")) {
    const reviewToken = decodeURIComponent(url.pathname.split("/").pop());
    const item = (await readRecordings()).find((recording) => recording.reviewToken === reviewToken);
    if (!item) {
      sendJson(res, 404, { ok: false, error: "Review link not found" });
      return;
    }
    sendJson(res, 200, { ok: true, recording: { ...item, wallet: undefined, ip: undefined } });
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin-recordings") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, recordings: await readRecordings() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin-audit") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { ok: true, audit: await readJson(auditPath, []) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/bracket") {
    sendJson(res, 200, { ok: true, bracket: await readBracket(), settings: await readSettings() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin-bracket") {
    if (!requireAdmin(req, res)) return;
    const settings = await readSettings();
    const payload = parseJsonBody(await readBody(req));

    if (payload.action === "lock") {
      await writeSettings({ bracketLocked: Boolean(payload.locked) });
      await appendAudit("bracket.lock", { locked: Boolean(payload.locked) }, req);
      sendJson(res, 200, { ok: true, settings: await readSettings(), bracket: await readBracket() });
      return;
    }

    if (settings.bracketLocked && payload.action !== "reset") {
      sendJson(res, 423, { ok: false, error: "Bracket is locked" });
      return;
    }

    if (payload.action === "reset") {
      const fresh = defaultBracket();
      await writeBracket(fresh);
      await appendAudit("bracket.reset", {}, req);
      sendJson(res, 200, { ok: true, bracket: fresh });
      return;
    }

    const bracket = await readBracket();
    if (payload.action === "updateMatch") {
      const match = findMatch(bracket, payload.matchId);
      if (!match) {
        sendJson(res, 400, { ok: false, error: "Match not found" });
        return;
      }
      match.label = payload.label || match.label;
      match.deadline = payload.deadline || "";
      match.players = payload.players || match.players;
      await writeBracket(bracket);
      await appendAudit("bracket.match.updated", { matchId: payload.matchId }, req);
      sendJson(res, 200, { ok: true, bracket });
      return;
    }

    if (payload.action === "createMatch") {
      const round = bracket.rounds.find((item) => item.name === payload.roundName) || bracket.rounds[0];
      round.matches.push({
        id: `match-${Date.now()}`,
        label: payload.label || `Match ${round.matches.length + 1}`,
        deadline: payload.deadline || "",
        players: payload.players || [{ name: "TBD", country: "TBD" }, { name: "TBD", country: "TBD" }],
        winner: null,
        nextMatch: null,
        nextSlot: null,
      });
      await writeBracket(bracket);
      await appendAudit("bracket.match.created", { roundName: round.name }, req);
      sendJson(res, 200, { ok: true, bracket });
      return;
    }

    const match = findMatch(bracket, payload.matchId);
    if (!match || typeof payload.playerIndex !== "number" || !match.players[payload.playerIndex]) {
      sendJson(res, 400, { ok: false, error: "Invalid bracket action" });
      return;
    }
    const winner = match.players[payload.playerIndex];
    match.winner = payload.playerIndex;
    if (match.nextMatch) {
      const next = findMatch(bracket, match.nextMatch);
      if (next) next.players[match.nextSlot] = winner;
    } else {
      bracket.champion = winner;
    }
    await writeBracket(bracket);
    await appendAudit("bracket.winner.selected", { matchId: match.id, winner }, req);
    sendJson(res, 200, { ok: true, bracket });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin-status") {
    if (!requireAdmin(req, res)) return;
    const payload = parseJsonBody(await readBody(req));
    const recordings = (await readRecordings()).map((item) =>
      item.recordingId === payload.recordingId
        ? { ...item, status: payload.status || "Approved", publicNote: payload.publicNote || item.publicNote, adminNote: payload.adminNote || item.adminNote }
        : item,
    );
    await writeRecordings(recordings);
    await appendAudit("recording.status.updated", payload, req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin-settings") {
    if (!requireAdmin(req, res)) return;
    const payload = parseJsonBody(await readBody(req));
    await writeSettings(payload);
    await appendAudit("settings.updated", payload, req);
    sendJson(res, 200, { ok: true, settings: await readSettings() });
    return;
  }

  let route = decodeURIComponent(url.pathname);
  if (route === "/" || route === "") route = "/index.html";
  const file = path.normalize(path.join(root, route));

  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

if (require.main === module) {
  http.createServer((req, res) => requestHandler(req, res).catch((error) => sendJson(res, 500, { ok: false, error: error.message || "Server error" }))).listen(port, "127.0.0.1", () => {
    console.log(`Server running at http://127.0.0.1:${port}`);
    console.log(`Admin login: ${adminUser} / ${adminPassword}`);
    console.log(`Storage mode: ${storageMode}${r2Enabled ? " (R2 configured)" : ""}`);
  });
}

module.exports = (req, res) => requestHandler(req, res).catch((error) => sendJson(res, 500, { ok: false, error: error.message || "Server error" }));
