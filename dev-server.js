const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webm": "video/webm",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function ensureDataDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readRecordings() {
  return readJson(recordingsPath, []);
}

function writeRecordings(recordings) {
  writeJson(recordingsPath, recordings);
}

function defaultSettings() {
  return {
    bracketLocked: false,
    registrationLocked: false,
    minDurationSeconds: 10,
    tournamentName: "Offline Country Cup",
    storageMode,
    remoteStorageConfigured: Boolean(process.env.R2_BUCKET || process.env.S3_BUCKET),
  };
}

function readSettings() {
  return { ...defaultSettings(), ...readJson(settingsPath, {}) };
}

function writeSettings(settings) {
  writeJson(settingsPath, { ...readSettings(), ...settings });
}

function appendAudit(action, details, req) {
  const audit = readJson(auditPath, []);
  audit.unshift({
    id: crypto.randomUUID(),
    action,
    details,
    ip: req.socket.remoteAddress,
    at: new Date().toISOString(),
    admin: getSession(req)?.user || "system",
  });
  writeJson(auditPath, audit.slice(0, 500));
}

function defaultBracket() {
  return {
    champion: null,
    rounds: [
      {
        name: "Quarter Finals",
        matches: [
          {
            id: "qf-1",
            label: "Match 1",
            deadline: "",
            players: [
              { name: "Player A", country: "Turkey" },
              { name: "Player B", country: "Germany" },
            ],
            winner: null,
            nextMatch: "sf-1",
            nextSlot: 0,
          },
          {
            id: "qf-2",
            label: "Match 2",
            deadline: "",
            players: [
              { name: "Player C", country: "France" },
              { name: "Player D", country: "Italy" },
            ],
            winner: null,
            nextMatch: "sf-1",
            nextSlot: 1,
          },
          {
            id: "qf-3",
            label: "Match 3",
            deadline: "",
            players: [
              { name: "Player E", country: "Spain" },
              { name: "Player F", country: "Poland" },
            ],
            winner: null,
            nextMatch: "sf-2",
            nextSlot: 0,
          },
          {
            id: "qf-4",
            label: "Match 4",
            deadline: "",
            players: [
              { name: "Player G", country: "United Kingdom" },
              { name: "Player H", country: "United States" },
            ],
            winner: null,
            nextMatch: "sf-2",
            nextSlot: 1,
          },
        ],
      },
      {
        name: "Semi Finals",
        matches: [
          {
            id: "sf-1",
            label: "Match 5",
            deadline: "",
            players: [
              { name: "TBD", country: "Winner Match 1" },
              { name: "TBD", country: "Winner Match 2" },
            ],
            winner: null,
            nextMatch: "final-1",
            nextSlot: 0,
          },
          {
            id: "sf-2",
            label: "Match 6",
            deadline: "",
            players: [
              { name: "TBD", country: "Winner Match 3" },
              { name: "TBD", country: "Winner Match 4" },
            ],
            winner: null,
            nextMatch: "final-1",
            nextSlot: 1,
          },
        ],
      },
      {
        name: "Final",
        matches: [
          {
            id: "final-1",
            label: "Grand Final",
            deadline: "",
            players: [
              { name: "TBD", country: "Winner Match 5" },
              { name: "TBD", country: "Winner Match 6" },
            ],
            winner: null,
            nextMatch: null,
            nextSlot: null,
          },
        ],
      },
    ],
  };
}

function readBracket() {
  return readJson(bracketPath, defaultBracket());
}

function writeBracket(bracket) {
  writeJson(bracketPath, bracket);
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

function saveUploadedRecording(body, metadata) {
  ensureDataDir();
  const safeId = String(metadata.recordingId).replace(/[^a-z0-9-]/gi, "_");
  const fileName = `${safeId}.webm`;
  const filePath = path.join(uploadDir, fileName);

  if (storageMode !== "local" && !(process.env.R2_BUCKET || process.env.S3_BUCKET)) {
    // Remote storage adapter hook. In production wire this to S3/R2 SDK credentials.
    fs.writeFileSync(filePath, body);
    return { fileName, videoUrl: `/uploads/${fileName}`, storage: "local-fallback" };
  }

  fs.writeFileSync(filePath, body);
  return { fileName, videoUrl: `/uploads/${fileName}`, storage: "local" };
}

async function requestHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/admin-login") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (body.username !== adminUser || body.password !== adminPassword) {
        sendJson(res, 401, { ok: false, error: "Invalid credentials" });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { user: body.username, expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
      appendAudit("admin.login", { user: body.username }, req);
      sendJson(res, 200, { ok: true, token, user: body.username });
      return;
    }

    if (req.method === "GET" && url.pathname === "/settings") {
      sendJson(res, 200, { ok: true, settings: readSettings() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/upload") {
      const settings = readSettings();
      if (settings.registrationLocked) {
        sendJson(res, 423, { ok: false, error: "Registration is locked" });
        return;
      }
      try {
        const rawMeta = req.headers["x-recording-metadata"];
        const metadata = rawMeta ? JSON.parse(decodeURIComponent(rawMeta)) : {};
        const recordingId = req.headers["x-recording-id"] || metadata.recordingId || `recording-${Date.now()}`;
        const existing = readRecordings();
        if (existing.some((item) => item.recordingId === recordingId || item.wallet === metadata.wallet)) {
          sendJson(res, 409, { ok: false, error: "Duplicate recording or wallet" });
          return;
        }
        const durationSeconds = Number(metadata.metadata?.durationSeconds || 0);
        if (durationSeconds < settings.minDurationSeconds) {
          sendJson(res, 422, { ok: false, error: "Recording is shorter than the minimum duration" });
          return;
        }

        const body = await readBody(req);
        if (!body.length) {
          sendJson(res, 422, { ok: false, error: "Video file is empty or corrupted" });
          return;
        }

        const storage = saveUploadedRecording(body, { ...metadata, recordingId });
        const reviewToken = crypto.randomBytes(18).toString("hex");
        const record = {
          ...metadata,
          recordingId,
          ...storage,
          reviewToken,
          reviewUrl: `/review/${reviewToken}`,
          statusUrl: `/status/${recordingId}`,
          uploadedAt: new Date().toISOString(),
          status: metadata.status || "Pending review",
          ip: req.socket.remoteAddress,
          publicNote: "",
          adminNote: "",
        };
        existing.unshift(record);
        writeRecordings(existing);
        appendAudit("recording.uploaded", { recordingId, username: metadata.username }, req);
        sendJson(res, 200, { ok: true, ...storage, recordingId, reviewUrl: record.reviewUrl, statusUrl: record.statusUrl });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: "Upload failed" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const recordingId = decodeURIComponent(url.pathname.split("/").pop());
      const item = readRecordings().find((recording) => recording.recordingId === recordingId);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "Recording not found" });
        return;
      }
      sendJson(res, 200, { ok: true, recording: publicRecording(item) });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/review/")) {
      const reviewToken = decodeURIComponent(url.pathname.split("/").pop());
      const item = readRecordings().find((recording) => recording.reviewToken === reviewToken);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "Review link not found" });
        return;
      }
      sendJson(res, 200, { ok: true, recording: { ...item, wallet: undefined, ip: undefined } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin-recordings") {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, { ok: true, recordings: readRecordings() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin-audit") {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, { ok: true, audit: readJson(auditPath, []) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/bracket") {
      sendJson(res, 200, { ok: true, bracket: readBracket(), settings: readSettings() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin-bracket") {
      if (!requireAdmin(req, res)) return;
      const settings = readSettings();
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8") || "{}");

      if (payload.action === "lock") {
        writeSettings({ bracketLocked: Boolean(payload.locked) });
        appendAudit("bracket.lock", { locked: Boolean(payload.locked) }, req);
        sendJson(res, 200, { ok: true, settings: readSettings(), bracket: readBracket() });
        return;
      }

      if (settings.bracketLocked && payload.action !== "reset") {
        sendJson(res, 423, { ok: false, error: "Bracket is locked" });
        return;
      }

      if (payload.action === "reset") {
        const fresh = defaultBracket();
        writeBracket(fresh);
        appendAudit("bracket.reset", {}, req);
        sendJson(res, 200, { ok: true, bracket: fresh });
        return;
      }

      const bracket = readBracket();
      if (payload.action === "updateMatch") {
        const match = findMatch(bracket, payload.matchId);
        if (!match) {
          sendJson(res, 400, { ok: false, error: "Match not found" });
          return;
        }
        match.label = payload.label || match.label;
        match.deadline = payload.deadline || "";
        match.players = payload.players || match.players;
        writeBracket(bracket);
        appendAudit("bracket.match.updated", { matchId: payload.matchId }, req);
        sendJson(res, 200, { ok: true, bracket });
        return;
      }

      if (payload.action === "createMatch") {
        const round = bracket.rounds.find((item) => item.name === payload.roundName) || bracket.rounds[0];
        round.matches.push({
          id: `match-${Date.now()}`,
          label: payload.label || `Match ${round.matches.length + 1}`,
          deadline: payload.deadline || "",
          players: payload.players || [
            { name: "TBD", country: "TBD" },
            { name: "TBD", country: "TBD" },
          ],
          winner: null,
          nextMatch: null,
          nextSlot: null,
        });
        writeBracket(bracket);
        appendAudit("bracket.match.created", { roundName: round.name }, req);
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
      writeBracket(bracket);
      appendAudit("bracket.winner.selected", { matchId: match.id, winner }, req);
      sendJson(res, 200, { ok: true, bracket });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin-status") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const recordings = readRecordings().map((item) =>
        item.recordingId === payload.recordingId
          ? { ...item, status: payload.status || "Approved", publicNote: payload.publicNote || item.publicNote, adminNote: payload.adminNote || item.adminNote }
          : item,
      );
      writeRecordings(recordings);
      appendAudit("recording.status.updated", payload, req);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin-settings") {
      if (!requireAdmin(req, res)) return;
      const payload = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      writeSettings(payload);
      appendAudit("settings.updated", payload, req);
      sendJson(res, 200, { ok: true, settings: readSettings() });
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
  http.createServer(requestHandler).listen(port, "127.0.0.1", () => {
    console.log(`Server running at http://127.0.0.1:${port}`);
    console.log(`Admin login: ${adminUser} / ${adminPassword}`);
    console.log(`Storage mode: ${storageMode}`);
  });
}

module.exports = requestHandler;
