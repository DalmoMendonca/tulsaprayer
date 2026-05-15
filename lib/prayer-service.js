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
  const blobPrayers = await readBlobPrayers();
  if (blobPrayers) return blobPrayers;
  return readLocalPrayers();
}

async function createPrayer(input) {
  const now = new Date().toISOString();
  const areaId = cleanId(input.areaId);
  const areaName = cleanText(input.areaName || "", 100);
  const name = cleanText(input.name || "Anonymous", maxNameLength) || "Anonymous";
  const audio = normalizeAudio(input.audio);
  const submittedText = cleanText(input.text || "", maxTextLength);
  const transcript = audio && !submittedText ? await transcribeAudio(audio) : "";
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

  const blobStore = getBlobStore();
  if (blobStore) {
    if (audio) {
      const audioKey = `audio/${entry.id}`;
      await blobStore.set(audioKey, Buffer.from(audio.data, "base64"), {
        metadata: { contentType: audio.mimeType, filename: audio.filename },
      });
      entry.audioFileId = audioKey;
      entry.audioMimeType = audio.mimeType;
      entry.audioUrl = `/api/prayers/audio/${entry.id}`;
    }
    const prayers = await readBlobPrayers(blobStore);
    prayers[areaId] = [entry, ...(prayers[areaId] || [])];
    await writeBlobPrayers(prayers, blobStore);
    return prayers;
  }
  if (isServerlessRuntime()) throw httpError(503, "Prayer storage is not configured yet.");

  const prayers = await readLocalPrayers();
  prayers[areaId] = [entry, ...(prayers[areaId] || [])];
  await writeLocalPrayers(prayers);
  return prayers;
}

async function transcribeRecording(input) {
  const audio = normalizeAudio(input.audio);
  if (!audio) throw httpError(400, "Record a prayer first.");
  return { text: await transcribeAudio(audio) };
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

  const blobStore = getBlobStore();
  if (blobStore) {
    const prayers = await readBlobPrayers(blobStore);
    prayers[cleanAreaId] = [];
    await writeBlobPrayers(prayers, blobStore);
    return prayers;
  }

  const prayers = await readLocalPrayers();
  prayers[cleanAreaId] = [];
  await writeLocalPrayers(prayers);
  return prayers;
}

async function deletePrayer(areaId, prayerId, password) {
  const cleanAreaId = cleanId(areaId);
  const cleanPrayerId = cleanText(prayerId || "", 80);
  if (password !== adminPassword) throw httpError(401, "Unauthorized.");
  if (!cleanAreaId || !cleanPrayerId) throw httpError(400, "Prayer not found.");

  const scriptUrl = env("GOOGLE_SCRIPT_URL");
  if (scriptUrl) {
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "deletePrayer", areaId: cleanAreaId, prayerId: cleanPrayerId, password }),
    });
    const payload = await readJsonResponse(response);
    return normalizePrayerMap(payload.prayers || payload);
  }

  const blobStore = getBlobStore();
  if (blobStore) {
    const prayers = await readBlobPrayers(blobStore);
    prayers[cleanAreaId] = (prayers[cleanAreaId] || []).filter((entry) => entry.id !== cleanPrayerId);
    await writeBlobPrayers(prayers, blobStore);
    return prayers;
  }

  const prayers = await readLocalPrayers();
  prayers[cleanAreaId] = (prayers[cleanAreaId] || []).filter((entry) => entry.id !== cleanPrayerId);
  await writeLocalPrayers(prayers);
  return prayers;
}

async function getAudio(id) {
  const cleanAudioId = cleanText(id || "", 80);
  if (!/^[a-f0-9-]{20,80}$/i.test(cleanAudioId)) throw httpError(404, "Audio not found.");
  const blobStore = getBlobStore();
  if (!blobStore) throw httpError(404, "Audio not found.");
  const result = await blobStore.getWithMetadata(`audio/${cleanAudioId}`, { type: "arrayBuffer" });
  if (!result?.data) throw httpError(404, "Audio not found.");
  return {
    data: result.data,
    contentType: result.metadata?.contentType || (await findAudioContentType(cleanAudioId)) || "audio/webm",
  };
}

async function moderatePrayer(text) {
  const deterministic = deterministicModeration(text);
  if (!deterministic.allowed) return deterministic;

  const openaiApiKey = env("OPENAI_API_KEY");
  if (!openaiApiKey) {
    return heuristicModeration(text);
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
            "You moderate a public neighborhood prayer wall. The only allowed posts are sincere prayer requests, blessings, laments addressed in a prayerful way, gratitude, encouragement, or well wishes for people or places. Allow short informal posts only when the prayer/well-wish intent is clear. Reject mere opinions, complaints, insults, negativity about a place/person, vandalism, spam, threats, targeted harassment, hate, sexual content, doxxing, political campaigning, ads, nonsense keyboard mashing, or anything not clearly a prayer or well-wish. Examples to reject: 'this place is ugly', 'I do not like this place', 'mingo valley sucks'. Return only compact JSON.",
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
    const allowed = Boolean(parsed.allowed);
    const finalGate = allowed ? finalPrayerIntentGate(text) : { allowed: true, reason: "ai rejected" };
    if (!finalGate.allowed) return finalGate;
    return {
      allowed,
      reason: cleanText(parsed.reason || (allowed ? "approved" : "rejected"), 180),
    };
  } catch {
    throw httpError(502, "Moderation returned an unreadable response.");
  }
}

function heuristicModeration(text) {
  const normalized = text.toLowerCase();
  const keyboardMash = /^[\W_a-z]*$/.test(normalized) && !/[aeiou]/.test(normalized) && normalized.length > 20;
  if (keyboardMash) {
    return { allowed: false, reason: "This looks like vandalism rather than a prayer request." };
  }
  const finalGate = finalPrayerIntentGate(text);
  if (!finalGate.allowed) return finalGate;
  return { allowed: true, reason: "approved by fallback moderation" };
}

function deterministicModeration(text) {
  const normalized = ` ${text.toLowerCase().replace(/[\u2019\u2018]/g, "'").replace(/[@$!]/g, (match) => ({ "@": "a", "$": "s", "!": "i" })[match]).replace(/\s+/g, " ")} `;
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  const hardRejectPatterns = [
    { pattern: /f+\W*u+\W*c+\W*k+/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /f+\W*c+\W*k+/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /s+\W*h+\W+i+\W*t+/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /s+\W*h+\W*t+/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /b+\W*i+\W*t+\W*c+\W*h+/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /c+\W*u+\W*n+\W*t+/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /\bf+u+c+k+\b/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /\bs+h+i+t+\b/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /\bb+i+t+c+h+\b/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /\bc+u+n+t+\b/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /\bd+i+c+k+\b/, reason: "Please keep prayer requests free of profanity or vandalism." },
    { pattern: /\b(kill|murder|bomb|shoot|stab)\b/, reason: "Threatening language cannot be posted to the prayer wall." },
    { pattern: /\bhttps?:\/\//, reason: "Links are not allowed on the public prayer wall." },
    { pattern: /\b(ugly|sucks?|trash|garbage|stupid|awful|terrible|hate|disgusting|worst)\b/, reason: "Please write this as a prayer or well-wish, not an insult or complaint." },
    { pattern: /\b(i\s+do\s+not|i\s+don't|dont|don't)\s+like\b/, reason: "Please write this as a prayer or well-wish, not an insult or complaint." },
    { pattern: /(.)\1{12,}/, reason: "This looks like vandalism rather than a prayer request." },
  ];
  const rejection = hardRejectPatterns.find(({ pattern }) => pattern.test(normalized));
  if (rejection) return { allowed: false, reason: rejection.reason };
  if (/(fuck|shit|bitch|cunt|dick)/.test(compact)) {
    return { allowed: false, reason: "Please keep prayer requests free of profanity or vandalism." };
  }
  return { allowed: true, reason: "passed deterministic moderation" };
}

function finalPrayerIntentGate(text) {
  const normalized = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, " ").replace(/\s+/g, " ")} `;
  const prayerSignals = [
    /\b(pray|prayer|praying|bless|blessing|blessed)\b/,
    /\b(lord|god|jesus|christ|spirit|amen)\b/,
    /\b(peace|hope|healing|heal|comfort|mercy|grace|protection|protect|safe|safety|strength|wisdom)\b/,
    /\b(thrive|flourish|prosper|restore|renew|care|support|encourage|encouragement)\b/,
    /\b(help|guide|provide|watch over|be with|lift up)\b/,
    /\b(may|please)\b.{0,80}\b(bless|help|heal|protect|comfort|guide|bring|give|restore|strengthen|support|encourage|provide|watch|find|receive|know|experience|have)\b/,
  ];
  if (prayerSignals.some((pattern) => pattern.test(normalized))) return { allowed: true, reason: "has prayer intent" };
  return { allowed: false, reason: "Please write this as a prayer or well-wish before posting." };
}

async function transcribeAudio(audio) {
  const openaiApiKey = env("OPENAI_API_KEY");
  if (!openaiApiKey) throw httpError(503, "Audio transcription is unavailable. Please try typing the prayer instead.");

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

async function readBlobPrayers(existingStore) {
  const blobStore = existingStore || getBlobStore();
  if (!blobStore) return null;
  const stored = await blobStore.get("prayers.json", { type: "json" });
  return normalizePrayerMap(stored || {});
}

async function writeBlobPrayers(prayers, existingStore) {
  const blobStore = existingStore || getBlobStore();
  if (!blobStore) return false;
  await blobStore.setJSON("prayers.json", normalizePrayerMap(prayers));
  return true;
}

function getBlobStore() {
  const context = getBlobContext();
  if (!context?.siteID || !context?.token || (!context.edgeURL && !context.apiURL)) return null;
  return createBlobStore(context, "prayers");
}

function isServerlessRuntime() {
  return Boolean(env("NETLIFY") || env("AWS_LAMBDA_FUNCTION_NAME"));
}

function getBlobContext() {
  const encoded = env("NETLIFY_BLOBS_CONTEXT");
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function createBlobStore(context, name) {
  const storeName = `site:${name}`;
  return {
    async get(key, options = {}) {
      const response = await blobFetch(context, storeName, key, "GET");
      if (response.status === 404) return null;
      if (!response.ok) throw httpError(502, `Blob read failed: ${response.status}`);
      if (options.type === "json") return response.json();
      if (options.type === "arrayBuffer") return response.arrayBuffer();
      return response.text();
    },
    async getWithMetadata(key, options = {}) {
      const response = await blobFetch(context, storeName, key, "GET");
      if (response.status === 404) return null;
      if (!response.ok) throw httpError(502, `Blob read failed: ${response.status}`);
      const metadata = decodeBlobMetadata(response.headers.get("netlify-blobs-metadata") || response.headers.get("x-amz-meta-user"));
      const data = options.type === "arrayBuffer" ? await response.arrayBuffer() : await response.text();
      return { data, metadata };
    },
    async set(key, value, options = {}) {
      const response = await blobFetch(context, storeName, key, "PUT", value, options.metadata);
      if (!response.ok) throw httpError(502, `Blob write failed: ${response.status}`);
    },
    async setJSON(key, value) {
      const response = await blobFetch(context, storeName, key, "PUT", JSON.stringify(value), null, {
        "content-type": "application/json",
      });
      if (!response.ok) throw httpError(502, `Blob write failed: ${response.status}`);
    },
  };
}

async function blobFetch(context, storeName, key, method, body, metadata, extraHeaders = {}) {
  const pathParts = [context.siteID, storeName];
  if (key) pathParts.push(...key.split("/").map(encodeURIComponent));
  const edgeBase = context.uncachedEdgeURL || context.edgeURL;
  if (edgeBase) {
    const url = new URL(`/${pathParts.join("/")}`, edgeBase);
    const headers = {
      authorization: `Bearer ${context.token}`,
      ...extraHeaders,
    };
    const encodedMetadata = encodeBlobMetadata(metadata);
    if (encodedMetadata) headers["x-amz-meta-user"] = encodedMetadata;
    return fetch(url, { method, headers, body });
  }

  const apiURL = context.apiURL || "https://api.netlify.com";
  const url = new URL(`/api/v1/blobs/${pathParts.join("/")}`, apiURL);
  const headers = {
    authorization: `Bearer ${context.token}`,
    ...extraHeaders,
  };
  const encodedMetadata = encodeBlobMetadata(metadata);
  if (encodedMetadata) headers["netlify-blobs-metadata"] = encodedMetadata;
  if (method !== "PUT") return fetch(url, { method, headers });

  const signed = await fetch(url, {
    method,
    headers: { ...headers, accept: "application/json;type=signed-url" },
  });
  if (!signed.ok) return signed;
  const { url: signedURL } = await signed.json();
  return fetch(signedURL, {
    method,
    headers: encodedMetadata ? { "x-amz-meta-user": encodedMetadata, ...extraHeaders } : extraHeaders,
    body,
  });
}

function encodeBlobMetadata(metadata) {
  if (!metadata) return "";
  return `b64;${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}`;
}

function decodeBlobMetadata(value) {
  if (!value?.startsWith("b64;")) return {};
  try {
    return JSON.parse(Buffer.from(value.slice(4), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

async function findAudioContentType(id) {
  const prayers = await listPrayers();
  const entry = Object.values(prayers).flat().find((prayer) => prayer.id === id);
  return entry?.audioMimeType || "";
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
        audioMimeType: cleanText(entry.audioMimeType || "", 80),
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
  deletePrayer,
  transcribeRecording,
  getAudio,
  httpError,
};
