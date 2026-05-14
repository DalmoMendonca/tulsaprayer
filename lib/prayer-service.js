const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "prayers.json");
const adminPassword = env("ADMIN_PASSWORD") || "dragonfly";
const maxTextLength = 1200;
const maxNameLength = 42;
const maxAudioBytes = 8 * 1024 * 1024;
const maxAudioSeconds = 300;
const moderationModel = env("OPENAI_MODERATION_MODEL") || "gpt-5.4-nano";
const transcriptionModel = env("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-mini-transcribe";

async function listPrayers() {
  const scriptUrl = env("GOOGLE_SCRIPT_URL");
  if (scriptUrl) {
    const response = await fetch(`${scriptUrl}?action=list`, {
      headers: { Accept: "application/json" },
    });
    const payload = await readJsonResponse(response);
    return normalizePrayerMap(payload.prayers || payload);
  }
  return readLocalPrayers();
}

async function createPrayer(input) {
  const now = new Date().toISOString();
  const areaId = cleanId(input.areaId);
  const areaName = cleanText(input.areaName || "", 100);
  const name = cleanText(input.name || "Anonymous", maxNameLength) || "Anonymous";
  const audio = normalizeAudio(input.audio);
  const submittedText = cleanText(input.text || "", maxTextLength);
  const transcript = audio ? await transcribeAudio(audio) : "";
  const text = composePrayerText(submittedText, transcript);

  if (!areaId) throw httpError(400, "Select a neighborhood first.");
  if (!text) throw httpError(400, "Write a prayer or record one.");

  const moderation = await moderatePrayer(text);
  if (!moderation.allowed) {
    await logModeration({ areaId, submittedText: text, decision: "rejected", reason: moderation.reason });
    throw httpError(422, moderation.reason || "This does not look like a prayer request.");
  }

  const entry = {
    id: randomUUID(),
    areaId,
    areaName,
    name,
    text,
    audioFileId: "",
    audioUrl: "",
    createdAt: now,
    moderationStatus: "approved",
    moderationReason: moderation.reason || "approved",
    source: audio ? "audio" : "text",
  };

  const scriptUrl = env("GOOGLE_SCRIPT_URL");
  if (scriptUrl) {
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "create", prayer: entry, audio }),
    });
    const payload = await readJsonResponse(response);
    return normalizePrayerMap(payload.prayers || payload);
  }

  if (env("ALLOW_UNMODERATED_LOCAL") !== "1") {
    throw httpError(503, "Prayer storage is not configured yet.");
  }

  const prayers = await readLocalPrayers();
  prayers[areaId] = [entry, ...(prayers[areaId] || [])];
  await writeLocalPrayers(prayers);
  return prayers;
}

async function clearArea(areaId, password) {
  const cleanAreaId = cleanId(areaId);
  if (password !== adminPassword) throw httpError(401, "Unauthorized.");
  if (!cleanAreaId) throw httpError(400, "Area is required.");

  const scriptUrl = env("GOOGLE_SCRIPT_URL");
  if (scriptUrl) {
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "delete", areaId: cleanAreaId, password }),
    });
    const payload = await readJsonResponse(response);
    return normalizePrayerMap(payload.prayers || payload);
  }

  const prayers = await readLocalPrayers();
  prayers[cleanAreaId] = [];
  await writeLocalPrayers(prayers);
  return prayers;
}

async function moderatePrayer(text) {
  const openaiApiKey = env("OPENAI_API_KEY");
  if (!openaiApiKey) {
    if (env("ALLOW_UNMODERATED_LOCAL") === "1") {
      return { allowed: true, reason: "local moderation skipped" };
    }
    throw httpError(503, "OpenAI moderation is not configured yet.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: moderationModel,
      input: [
        {
          role: "system",
          content:
            "You moderate a public neighborhood prayer wall. Allow sincere prayer requests, blessings, laments, grief, gratitude, encouragement, and broad well wishes, including short or informal wording. Reject vandalism, spam, threats, targeted harassment, hate, sexual content, doxxing, political campaigning, ads, nonsense keyboard mashing, or content clearly unrelated to prayer/well wishes. Return only compact JSON.",
        },
        {
          role: "user",
          content: `Prayer submission:\n${text}`,
        },
      ],
      reasoning: { effort: "none" },
      text: {
        format: {
          type: "json_schema",
          name: "prayer_moderation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              allowed: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["allowed", "reason"],
          },
        },
      },
      max_output_tokens: 80,
    }),
  });

  const payload = await readJsonResponse(response);
  const raw = payload.output_text || payload.output?.flatMap((item) => item.content || [])?.find((item) => item.text)?.text;
  try {
    const parsed = JSON.parse(raw || "{}");
    return {
      allowed: Boolean(parsed.allowed),
      reason: cleanText(parsed.reason || (parsed.allowed ? "approved" : "rejected"), 180),
    };
  } catch {
    throw httpError(502, "Moderation returned an unreadable response.");
  }
}

async function transcribeAudio(audio) {
  const openaiApiKey = env("OPENAI_API_KEY");
  if (!openaiApiKey) throw httpError(503, "Audio transcription is not configured yet.");

  const buffer = Buffer.from(audio.data, "base64");
  const form = new FormData();
  form.append("model", transcriptionModel);
  form.append("file", new Blob([buffer], { type: audio.mimeType }), audio.filename || "prayer.webm");
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiApiKey}` },
    body: form,
  });
  const payload = await readJsonResponse(response);
  return cleanText(payload.text || "", maxTextLength);
}

async function logModeration(record) {
  const scriptUrl = env("GOOGLE_SCRIPT_URL");
  if (!scriptUrl) return;
  try {
    await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "moderationLog",
        record: {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          model: moderationModel,
          source: "server",
          ...record,
        },
      }),
    });
  } catch {
    // Moderation logging should never block a user-facing rejection.
  }
}

function composePrayerText(typedText, transcript) {
  if (transcript && typedText) return `${typedText}\n\nTranscript: ${transcript}`.slice(0, maxTextLength);
  return (transcript || typedText).slice(0, maxTextLength);
}

function normalizeAudio(audio) {
  if (!audio) return null;
  const mimeType = cleanText(audio.mimeType || "audio/webm", 80);
  const data = String(audio.data || "");
  const durationSeconds = Number(audio.durationSeconds || 0);
  const byteLength = Math.ceil((data.length * 3) / 4);
  if (!data) return null;
  if (durationSeconds > maxAudioSeconds + 1) throw httpError(400, "Recordings are limited to 5 minutes.");
  if (byteLength > maxAudioBytes) throw httpError(413, "Audio recording is too large.");
  if (!/^audio\//.test(mimeType)) throw httpError(400, "Recording must be an audio file.");
  return {
    data,
    mimeType,
    durationSeconds,
    filename: cleanText(audio.filename || "prayer.webm", 80),
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw httpError(502, "Remote service returned invalid JSON.");
  }
  if (!response.ok || payload.error) {
    throw httpError(response.status || 502, payload.error?.message || payload.error || "Remote service request failed.");
  }
  return payload;
}

async function readLocalPrayers() {
  try {
    const content = await fs.readFile(dataFile, "utf8");
    return normalizePrayerMap(JSON.parse(content));
  } catch {
    return {};
  }
}

async function writeLocalPrayers(prayers) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${dataFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(normalizePrayerMap(prayers), null, 2));
  await fs.rename(tempFile, dataFile);
}

function normalizePrayerMap(value) {
  const normalized = {};
  if (!value || typeof value !== "object") return normalized;
  Object.entries(value).forEach(([areaId, entries]) => {
    if (!Array.isArray(entries)) return;
    normalized[cleanId(areaId)] = entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: cleanText(entry.id || randomUUID(), 80),
        areaId: cleanId(entry.areaId || areaId),
        areaName: cleanText(entry.areaName || "", 100),
        name: cleanText(entry.name || "Anonymous", maxNameLength) || "Anonymous",
        text: cleanText(entry.text || "", maxTextLength),
        audioFileId: cleanText(entry.audioFileId || "", 120),
        audioUrl: cleanUrl(entry.audioUrl || ""),
        createdAt: Number.isNaN(Date.parse(entry.createdAt)) ? new Date().toISOString() : entry.createdAt,
        moderationStatus: cleanText(entry.moderationStatus || "approved", 40),
        moderationReason: cleanText(entry.moderationReason || "", 180),
        source: cleanText(entry.source || "text", 20),
      }))
      .filter((entry) => entry.text);
  });
  return normalized;
}

function cleanId(value) {
  const text = String(value || "").trim();
  return /^[a-z0-9-]{3,40}$/i.test(text) ? text : "";
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function cleanUrl(value) {
  const text = cleanText(value, 500);
  return /^https:\/\/[^\s"<>]+$/i.test(text) || /^data:audio\//i.test(text) ? text : "";
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function env(name) {
  const processValue = process.env[name];
  if (processValue) return processValue;
  if (globalThis.Netlify?.env?.get) return globalThis.Netlify.env.get(name);
  return "";
}

module.exports = {
  listPrayers,
  createPrayer,
  clearArea,
  httpError,
};
