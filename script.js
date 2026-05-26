const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const viewLinks = $$("[data-view-link]");
const viewPanels = $$(".view-panel");
const openSignupButton = $("#openSignup");
const continueButton = $("#continueToRecorder");
const verificationForm = $("#verificationForm");
const verificationPanel = $("#verification");
const recorderPanel = $("#record");
const statusPanel = $("#statusPanel");
const startButton = $("#startRecording");
const stopButton = $("#stopRecording");
const submitButton = $("#submitRecording");
const stateText = $("#stateText");
const recordingState = $("#recordingState");
const timer = $("#timer");
const preview = $("#preview");
const meta = $("#submissionMeta");
const recordingIdText = $("#recordingId");
const countdown = $("#countdown");
const uploadBar = $("#uploadBar");
const uploadText = $("#uploadText");
const adminPanel = $("#adminPanel");
const adminLogin = $("#adminLogin");
const adminWorkspace = $("#adminWorkspace");
const adminList = $("#adminList");
const bracketGrid = $("#bracketGrid");
const adminBracketControls = $("#adminBracketControls");
const adminAccess = $("#adminAccess");
const closeAdmin = $("#closeAdmin");
const countrySelect = $("#countryA");
const countryFlag = $("#countryFlag");
const formError = $("#formError");
const copyRecordingIdButton = $("#copyRecordingId");
const successPanel = $("#successPanel");
const successRecordingId = $("#successRecordingId");
const closeSuccess = $("#closeSuccess");
const checklistItems = $$(".record-checklist input");
const stepItems = $$(".step-indicator span");
const adminFilterButtons = $$("[data-filter]");
const adminTabButtons = $$("[data-admin-tab]");
const statusLookupInput = $("#statusLookupInput");
const statusLookupButton = $("#statusLookupButton");
const statusResult = $("#statusResult");
const copySuccessId = $("#copySuccessId");
const openStatusFromSuccess = $("#openStatusFromSuccess");
const adminLoginButton = $("#adminLoginButton");
const adminLoginError = $("#adminLoginError");
const lockBracketButton = $("#lockBracketButton");
const createMatchButton = $("#createMatchButton");
const saveSettingsButton = $("#saveSettingsButton");
const auditList = $("#auditList");

let mediaRecorder;
let recordingStream;
let recordedChunks = [];
let recordedBlob;
let startedAt = 0;
let durationSeconds = 0;
let tickInterval;
let uploadStartedAt = 0;
let adminToken = localStorage.getItem("tollanAdminToken") || "";
let recordingId = createRecordingId();
let lastStatusUrl = "";
let isUploading = false;
let adminFilter = "all";
let adminRecordings = [];
let bracketState;
let appSettings = {};

const isMobileDevice = window.matchMedia("(max-width: 767px), (pointer: coarse) and (max-width: 1024px)").matches;

recordingIdText.textContent = recordingId;

function createRecordingId() {
  const stamp = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TOL-OFF-${stamp}-${random}`;
}

function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${adminToken}` };
}

function showView(viewId, updateHash = true) {
  viewPanels.forEach((panel) => panel.classList.toggle("is-hidden", panel.id !== viewId));
  viewLinks.forEach((link) => link.classList.toggle("active", link.dataset.viewLink === viewId));
  if (viewId === "bracketView") loadBracket();
  if (updateHash) {
    const link = viewLinks.find((item) => item.dataset.viewLink === viewId);
    if (link) history.replaceState(null, "", link.getAttribute("href"));
  }
}

function setStep(step) {
  stepItems.forEach((item) => item.classList.toggle("is-active", item.dataset.step === step));
}

function updateCountryFlag() {
  countryFlag.textContent = countrySelect.selectedOptions[0]?.dataset.code || "??";
}

function getPlayerInfo() {
  return {
    recordingId,
    discord: $("#discordUser").value.trim(),
    wallet: $("#walletAddress").value.trim(),
    country: countrySelect.value.trim(),
    username: $("#playerA").value.trim(),
  };
}

function getMetadata() {
  return {
    duration: `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
    durationSeconds,
    resolution: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    browser: navigator.userAgent,
    submittedAt: new Date().toLocaleString("en-US"),
  };
}

function updateTimer() {
  durationSeconds = Math.floor((Date.now() - startedAt) / 1000);
  timer.textContent = `${String(Math.floor(durationSeconds / 60)).padStart(2, "0")}:${String(durationSeconds % 60).padStart(2, "0")}`;
}

function setUpload(percent, text) {
  uploadBar.style.width = `${percent}%`;
  uploadText.textContent = text;
}

function setFieldValidity(input, isValid) {
  input.classList.toggle("is-invalid", !isValid);
}

function validateVerification(showErrors = true) {
  const info = getPlayerInfo();
  const walletValid = /^0x[a-fA-F0-9]{6,}$/.test(info.wallet);
  const rules = [
    [$("#discordUser"), Boolean(info.discord), "Discord username"],
    [$("#walletAddress"), Boolean(info.wallet) && walletValid, "valid wallet"],
    [$("#playerA"), Boolean(info.username), "username"],
  ];
  rules.forEach(([input, valid]) => setFieldValidity(input, valid || !input.value));
  const missing = rules.filter(([, valid]) => !valid).map(([, , label]) => label);
  if (showErrors) formError.textContent = missing.length ? `Please complete: ${missing.join(", ")}.` : "";
  return !missing.length;
}

function updateContinueState() {
  continueButton.disabled = !validateVerification(false);
}

function checklistComplete() {
  return checklistItems.every((item) => item.checked);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCountdown() {
  startButton.disabled = true;
  for (const value of ["3", "2", "1"]) {
    countdown.textContent = value;
    stateText.textContent = "Get ready";
    await wait(1000);
  }
  countdown.textContent = "GO";
  await wait(400);
  countdown.textContent = "";
}

function showVerification() {
  showView("recordView");
  verificationPanel.classList.remove("is-hidden");
  setStep("register");
  verificationPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showRecorder() {
  if (!validateVerification()) return;
  recorderPanel.classList.remove("is-hidden");
  statusPanel.classList.remove("is-hidden");
  setStep("record");
  recorderPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function startRecording() {
  if (isMobileDevice) {
    meta.textContent = "This recorder is available on desktop only.";
    return;
  }
  if (!validateVerification()) return;
  if (!checklistComplete()) {
    meta.textContent = "You must share your game screen. Complete the readiness checklist before starting.";
    return;
  }
  try {
    await runCountdown();
    recordedChunks = [];
    recordedBlob = null;
    setUpload(0, "Upload waiting");
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    recordingStream = stream;
    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    mediaRecorder.addEventListener("dataavailable", (event) => event.data.size > 0 && recordedChunks.push(event.data));
    mediaRecorder.addEventListener("stop", () => {
      recordedBlob = new Blob(recordedChunks, { type: "video/webm" });
      preview.src = URL.createObjectURL(recordedBlob);
      submitButton.disabled = false;
      document.body.classList.add("recording-ready");
      meta.textContent = "Recording is ready. Preview it, then submit it for admin review.";
    });
    mediaRecorder.start();
    startedAt = Date.now();
    durationSeconds = 0;
    tickInterval = setInterval(updateTimer, 250);
    updateTimer();
    document.body.classList.add("is-recording");
    document.body.classList.remove("recording-ready", "recording-submitted");
    stateText.textContent = "Recording";
    startButton.disabled = true;
    stopButton.disabled = false;
    submitButton.disabled = true;
  } catch {
    stateText.textContent = "Permission denied";
    startButton.disabled = false;
    meta.innerHTML = 'Screen sharing was denied. Click <button class="inline-button" type="button" onclick="document.querySelector(\'#startRecording\').click()">TRY AGAIN</button> and choose your game screen.';
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  mediaRecorder.stop();
  recordingStream.getTracks().forEach((track) => track.stop());
  clearInterval(tickInterval);
  document.body.classList.remove("is-recording");
  stateText.textContent = "Recording stopped";
  startButton.disabled = false;
  stopButton.disabled = true;
}

function uploadRecording(entry) {
  submitButton.disabled = true;
  stateText.textContent = "Uploading";
  isUploading = true;
  uploadStartedAt = Date.now();
  setStep("submit");
  setUpload(0, `Uploading 0% · ${entry.sizeMb} MB`);
  const request = new XMLHttpRequest();
  request.open("POST", "/upload");
  request.setRequestHeader("X-Recording-Metadata", encodeURIComponent(JSON.stringify(entry)));
  request.setRequestHeader("X-Recording-Id", entry.recordingId);
  request.upload.addEventListener("progress", (event) => {
    const elapsed = Math.max(1, (Date.now() - uploadStartedAt) / 1000);
    const percent = event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : 35;
    const remaining = event.lengthComputable && event.loaded ? Math.max(0, Math.round(((event.total - event.loaded) / (event.loaded / elapsed)))) : "?";
    setUpload(percent, `Uploading ${percent}% · ${entry.sizeMb} MB · ETA ${remaining}s`);
  });
  request.addEventListener("load", () => {
    isUploading = false;
    if (request.status >= 200 && request.status < 300) {
      const result = JSON.parse(request.responseText);
      lastStatusUrl = result.statusUrl;
      setUpload(100, "Upload complete");
      stateText.textContent = "Submitted";
      document.body.classList.add("recording-submitted");
      successRecordingId.textContent = entry.recordingId;
      successPanel.classList.remove("is-hidden");
      meta.innerHTML = `${entry.username} submitted recording ${entry.recordingId}. <button class="inline-button" type="button" data-open-status="${entry.recordingId}">Track status</button>`;
      return;
    }
    submitButton.disabled = false;
    setUpload(0, "Upload failed");
    stateText.textContent = "Upload failed";
    meta.textContent = JSON.parse(request.responseText || "{}").error || "The recording could not be uploaded.";
  });
  request.addEventListener("error", () => {
    isUploading = false;
    submitButton.disabled = false;
    setUpload(0, "Upload failed");
    stateText.textContent = "Upload failed";
    meta.textContent = "The local upload endpoint is unavailable.";
  });
  request.send(recordedBlob);
}

function submitRecording() {
  if (!recordedBlob) return;
  uploadRecording({ ...getPlayerInfo(), sizeMb: (recordedBlob.size / 1024 / 1024).toFixed(2), metadata: getMetadata(), status: "Pending review" });
}

function flagFor(country) {
  const codes = { Turkey: "🇹🇷", Germany: "🇩🇪", France: "🇫🇷", Spain: "🇪🇸", Poland: "🇵🇱", Italy: "🇮🇹", "United Kingdom": "🇬🇧", "United States": "🇺🇸" };
  return codes[country] || "🏳️";
}

function renderBracket(bracket) {
  bracketState = bracket;
  bracketGrid.innerHTML = `${bracket.champion ? `<div class="champion-banner">Champion: ${flagFor(bracket.champion.country)} ${bracket.champion.name} · ${bracket.champion.country}</div>` : ""}
    ${bracket.rounds
      .map(
        (round) => `<div class="bracket-round"><h3>${round.name}</h3>${round.matches
          .map(
            (match) => `<article class="bracket-match"><div class="bracket-status">${match.label}${match.deadline ? ` · Deadline ${match.deadline}` : ""}</div>${match.players
              .map((player, index) => `<div class="bracket-player ${match.winner === index ? "is-winner" : ""}"><strong>${flagFor(player.country)} ${player.name}</strong><span>${player.country}</span></div>`)
              .join("")}</article>`,
          )
          .join("")}</div>`,
      )
      .join("")}`;
}

function renderAdminBracketControls(bracket) {
  adminBracketControls.innerHTML = `${bracket.rounds
    .flatMap((round) => round.matches.map((match) => ({ round: round.name, match })))
    .map(
      ({ round, match }) => `<div class="admin-bracket-match">
        <strong>${round} · ${match.label}</strong>
        <input data-edit-label="${match.id}" value="${match.label}" />
        <input data-edit-deadline="${match.id}" placeholder="Deadline" value="${match.deadline || ""}" />
        <input data-edit-player="${match.id}" data-player-index="0" value="${match.players[0].name}" />
        <input data-edit-country="${match.id}" data-player-index="0" value="${match.players[0].country}" />
        <input data-edit-player="${match.id}" data-player-index="1" value="${match.players[1].name}" />
        <input data-edit-country="${match.id}" data-player-index="1" value="${match.players[1].country}" />
        <button class="rune-button ghost" type="button" data-save-match="${match.id}">SAVE</button>
        <button class="rune-button ghost" type="button" data-bracket-match="${match.id}" data-player-index="0">ADVANCE ${match.players[0].name}</button>
        <button class="rune-button ghost" type="button" data-bracket-match="${match.id}" data-player-index="1">ADVANCE ${match.players[1].name}</button>
      </div>`,
    )
    .join("")}<button class="rune-button danger" type="button" data-bracket-reset="true">RESET BRACKET</button>`;
}

async function loadSettings() {
  const data = await (await fetch("/settings")).json();
  appSettings = data.settings;
  $("#minDurationSetting").value = appSettings.minDurationSeconds;
  $("#tournamentNameSetting").value = appSettings.tournamentName;
  $("#registrationLockedSetting").checked = appSettings.registrationLocked;
  $("#bracketLockedSetting").checked = appSettings.bracketLocked;
  $("#storageInfo").textContent = `Storage: ${appSettings.storageMode}${appSettings.remoteStorageConfigured ? " remote configured" : " local fallback"}`;
  lockBracketButton.textContent = appSettings.bracketLocked ? "UNLOCK BRACKET" : "LOCK BRACKET";
}

async function loadBracket() {
  const data = await (await fetch("/bracket")).json();
  appSettings = data.settings || appSettings;
  renderBracket(data.bracket);
  if (adminToken) renderAdminBracketControls(data.bracket);
}

function renderAdminList(items) {
  const filtered = adminFilter === "all" ? items : items.filter((item) => item.status === adminFilter);
  adminList.innerHTML = filtered.length
    ? filtered
        .map(
          (item) => `<div class="admin-row">
            <div><strong>${item.username || "Unnamed"}</strong><br><span>${flagFor(item.country)} ${item.country || "No country"}</span></div>
            <div>${item.discord || "No Discord"}<br><span>${item.wallet || "No wallet"}</span></div>
            <div>${item.recordingId}<br><span>${item.sizeMb || "0.00"} MB · ${item.metadata?.duration || "-"}</span></div>
            <div>${item.status || "Pending review"}<br><a href="${item.statusUrl}" target="_blank">STATUS</a> · <a href="${item.reviewUrl}" target="_blank">REVIEW</a></div>
            <a href="${item.videoUrl}" target="_blank" rel="noreferrer">WATCH</a>
            <div class="decision-buttons">
              <input class="note-input" data-note="${item.recordingId}" placeholder="Public/admin note" />
              ${["Approved", "Winner", "Rejected", "Needs Review", "Disqualified"].map((status) => `<button class="rune-button ghost" type="button" data-status="${status}" data-recording="${item.recordingId}">${status === "Disqualified" ? "DQ" : status.toUpperCase()}</button>`).join("")}
            </div>
          </div>`,
        )
        .join("")
    : '<p class="empty-admin">No submitted recordings yet.</p>';
}

async function loadAdminRecordings() {
  const response = await fetch("/admin-recordings", { headers: authHeaders() });
  if (!response.ok) {
    adminLogin.classList.remove("is-hidden");
    adminWorkspace.classList.add("is-hidden");
    return;
  }
  const data = await response.json();
  adminRecordings = data.recordings || [];
  renderAdminList(adminRecordings);
  await loadBracket();
  await loadSettings();
  await loadAudit();
}

async function loadAudit() {
  const response = await fetch("/admin-audit", { headers: authHeaders() });
  if (!response.ok) return;
  const data = await response.json();
  auditList.innerHTML = (data.audit || []).slice(0, 80).map((item) => `<div class="audit-item"><strong>${item.action}</strong><br>${item.at} · ${item.admin}<br><span>${JSON.stringify(item.details)}</span></div>`).join("") || "No audit events yet.";
}

async function loginAdmin() {
  const response = await fetch("/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("#adminUser").value.trim(), password: $("#adminPassword").value }),
  });
  if (!response.ok) {
    adminLoginError.textContent = "Invalid admin credentials.";
    return;
  }
  const data = await response.json();
  adminToken = data.token;
  localStorage.setItem("tollanAdminToken", adminToken);
  adminLogin.classList.add("is-hidden");
  adminWorkspace.classList.remove("is-hidden");
  await loadAdminRecordings();
}

async function openAdminPanel() {
  adminPanel.classList.remove("is-hidden");
  if (adminToken) {
    adminLogin.classList.add("is-hidden");
    adminWorkspace.classList.remove("is-hidden");
    await loadAdminRecordings();
  }
}

async function setRecordingStatus(recordingIdToUpdate, status) {
  const note = $(`[data-note="${recordingIdToUpdate}"]`)?.value || "";
  await fetch("/admin-status", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ recordingId: recordingIdToUpdate, status, publicNote: note, adminNote: note }),
  });
  await loadAdminRecordings();
}

async function lookupStatus(id = statusLookupInput.value.trim()) {
  if (!id) return;
  const response = await fetch(`/status/${encodeURIComponent(id)}`);
  if (!response.ok) {
    statusResult.textContent = "Recording not found.";
    return;
  }
  const data = await response.json();
  const item = data.recording;
  statusResult.innerHTML = `<strong>${item.recordingId}</strong><br>${item.username} · ${flagFor(item.country)} ${item.country}<br>Status: ${item.status}<br>${item.adminNote || ""}`;
}

async function updateBracket(payload) {
  const response = await fetch("/admin-bracket", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) });
  if (response.ok) {
    const data = await response.json();
    renderBracket(data.bracket);
    renderAdminBracketControls(data.bracket);
    await loadSettings();
    await loadAudit();
  } else {
    alert((await response.json()).error || "Bracket update failed");
  }
}

viewLinks.forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showView(link.dataset.viewLink); }));
openSignupButton.addEventListener("click", showVerification);
continueButton.addEventListener("click", showRecorder);
startButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
submitButton.addEventListener("click", submitRecording);
countrySelect.addEventListener("change", updateCountryFlag);
adminAccess.addEventListener("click", openAdminPanel);
closeAdmin.addEventListener("click", () => adminPanel.classList.add("is-hidden"));
adminLoginButton.addEventListener("click", loginAdmin);
verificationForm.addEventListener("input", updateContinueState);
verificationForm.addEventListener("change", updateContinueState);
copyRecordingIdButton.addEventListener("click", async () => { await navigator.clipboard.writeText(recordingId); copyRecordingIdButton.textContent = "COPIED"; setTimeout(() => (copyRecordingIdButton.textContent = "COPY"), 1200); });
copySuccessId.addEventListener("click", async () => navigator.clipboard.writeText(successRecordingId.textContent));
openStatusFromSuccess.addEventListener("click", () => { successPanel.classList.add("is-hidden"); showView("statusView"); statusLookupInput.value = successRecordingId.textContent; lookupStatus(successRecordingId.textContent); });
closeSuccess.addEventListener("click", () => successPanel.classList.add("is-hidden"));
statusLookupButton.addEventListener("click", () => lookupStatus());
adminFilterButtons.forEach((button) => button.addEventListener("click", () => { adminFilter = button.dataset.filter; adminFilterButtons.forEach((item) => item.classList.toggle("is-active", item === button)); renderAdminList(adminRecordings); }));
adminTabButtons.forEach((button) => button.addEventListener("click", () => { adminTabButtons.forEach((item) => item.classList.toggle("is-active", item === button)); $$(".admin-tab-panel").forEach((panel) => panel.classList.toggle("is-hidden", panel.id !== button.dataset.adminTab)); }));
adminList.addEventListener("click", (event) => { const button = event.target.closest("[data-status]"); if (button) setRecordingStatus(button.dataset.recording, button.dataset.status); });
adminBracketControls.addEventListener("click", (event) => {
  const reset = event.target.closest("[data-bracket-reset]");
  const advance = event.target.closest("[data-bracket-match]");
  const save = event.target.closest("[data-save-match]");
  if (reset && confirm("Reset the entire bracket?")) updateBracket({ action: "reset" });
  if (advance && confirm("Advance this player to the next round?")) updateBracket({ action: "advance", matchId: advance.dataset.bracketMatch, playerIndex: Number(advance.dataset.playerIndex) });
  if (save) {
    const id = save.dataset.saveMatch;
    updateBracket({
      action: "updateMatch",
      matchId: id,
      label: $(`[data-edit-label="${id}"]`).value,
      deadline: $(`[data-edit-deadline="${id}"]`).value,
      players: [0, 1].map((index) => ({ name: $(`[data-edit-player="${id}"][data-player-index="${index}"]`).value, country: $(`[data-edit-country="${id}"][data-player-index="${index}"]`).value })),
    });
  }
});
lockBracketButton.addEventListener("click", () => updateBracket({ action: "lock", locked: !appSettings.bracketLocked }));
createMatchButton.addEventListener("click", () => updateBracket({ action: "createMatch", roundName: "Quarter Finals", label: "New Match" }));
saveSettingsButton.addEventListener("click", async () => { await fetch("/admin-settings", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ minDurationSeconds: Number($("#minDurationSetting").value), tournamentName: $("#tournamentNameSetting").value, registrationLocked: $("#registrationLockedSetting").checked, bracketLocked: $("#bracketLockedSetting").checked }) }); await loadSettings(); await loadAudit(); });
window.addEventListener("beforeunload", (event) => { if (!isUploading) return; event.preventDefault(); event.returnValue = ""; });

updateCountryFlag();
updateContinueState();
loadBracket();
loadSettings();
setTimeout(() => {
  if (location.hash === "#bracket") showView("bracketView", false);
  else if (location.hash === "#status") showView("statusView", false);
  else if (location.hash === "#signup" || location.hash === "#record") showView("recordView", false);
}, 0);
if (new URLSearchParams(location.search).get("admin") === "1") openAdminPanel();
if (isMobileDevice) {
  startButton.disabled = true;
  stateText.textContent = "Desktop required";
  meta.textContent = "This tournament recorder is closed on mobile devices.";
} else if (!("mediaDevices" in navigator) || !("MediaRecorder" in window)) {
  startButton.disabled = true;
  recordingState.classList.remove("is-recording");
  stateText.textContent = "Browser unsupported";
  meta.textContent = "Screen recording requires a modern desktop browser with MediaRecorder and getDisplayMedia support.";
}
