const PRAYERS_SHEET = "Prayers";
const AREAS_SHEET = "Areas";
const MODERATION_SHEET = "ModerationLog";
const AUDIO_FOLDER_NAME = "tulsaprayer-audio";

function doGet(e) {
  setupSheets_();
  return json_({ prayers: readPrayers_() });
}

function doPost(e) {
  setupSheets_();
  const body = JSON.parse((e.postData && e.postData.contents) || "{}");

  if (body.action === "create") {
    const prayer = body.prayer || {};
    const audio = body.audio || null;
    if (audio && audio.data) {
      const file = saveAudio_(prayer.id, audio);
      prayer.audioFileId = file.getId();
      prayer.audioUrl = "https://drive.google.com/uc?export=download&id=" + file.getId();
    }
    appendPrayer_(prayer);
    appendModeration_({
      id: Utilities.getUuid(),
      areaId: prayer.areaId,
      submittedText: prayer.text,
      decision: prayer.moderationStatus || "approved",
      reason: prayer.moderationReason || "approved",
      createdAt: new Date().toISOString(),
      model: "server",
      source: prayer.source || "text",
    });
    return json_({ prayers: readPrayers_() });
  }

  if (body.action === "delete") {
    const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD") || "dragonfly";
    if (body.password !== expected) return json_({ error: "Unauthorized." });
    deleteArea_(String(body.areaId || ""));
    return json_({ prayers: readPrayers_() });
  }

  if (body.action === "moderationLog") {
    appendModeration_(body.record || {});
    return json_({ ok: true });
  }

  return json_({ error: "Unknown action." });
}

function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, PRAYERS_SHEET, [
    "id",
    "areaId",
    "areaName",
    "name",
    "text",
    "audioFileId",
    "audioUrl",
    "createdAt",
    "moderationStatus",
    "moderationReason",
    "source",
  ]);
  ensureSheet_(ss, AREAS_SHEET, ["areaId", "mapId", "areaName", "conditionsScore", "population", "areaSqMiles"]);
  ensureSheet_(ss, MODERATION_SHEET, ["id", "areaId", "submittedText", "decision", "reason", "createdAt", "model", "source"]);
}

function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const missingHeaders = headers.some((header, index) => firstRow[index] !== header);
  if (missingHeaders) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function readPrayers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRAYERS_SHEET);
  const values = sheet.getDataRange().getValues();
  const prayers = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const areaId = row[1];
    const text = row[4];
    if (!areaId || !text) continue;
    const entry = {
      id: row[0],
      areaId: row[1],
      areaName: row[2],
      name: row[3] || "Anonymous",
      text: row[4],
      audioFileId: row[5],
      audioUrl: row[6],
      createdAt: row[7],
      moderationStatus: row[8],
      moderationReason: row[9],
      source: row[10],
    };
    prayers[areaId] = prayers[areaId] || [];
    prayers[areaId].push(entry);
  }
  Object.keys(prayers).forEach(function(areaId) {
    prayers[areaId].sort(function(a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });
  return prayers;
}

function appendPrayer_(prayer) {
  SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(PRAYERS_SHEET)
    .appendRow([
      prayer.id,
      prayer.areaId,
      prayer.areaName,
      prayer.name,
      prayer.text,
      prayer.audioFileId || "",
      prayer.audioUrl || "",
      prayer.createdAt,
      prayer.moderationStatus || "approved",
      prayer.moderationReason || "approved",
      prayer.source || "text",
    ]);
}

function appendModeration_(record) {
  SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(MODERATION_SHEET)
    .appendRow([
      record.id || Utilities.getUuid(),
      record.areaId || "",
      record.submittedText || "",
      record.decision || "",
      record.reason || "",
      record.createdAt || new Date().toISOString(),
      record.model || "",
      record.source || "",
    ]);
}

function deleteArea_(areaId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRAYERS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][1] === areaId) sheet.deleteRow(i + 1);
  }
}

function saveAudio_(prayerId, audio) {
  const folder = getOrCreateFolder_(AUDIO_FOLDER_NAME);
  const bytes = Utilities.base64Decode(audio.data);
  const extension = extensionForMime_(audio.mimeType || "audio/webm");
  const blob = Utilities.newBlob(bytes, audio.mimeType || "audio/webm", prayerId + extension);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file;
}

function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function extensionForMime_(mimeType) {
  if (mimeType.indexOf("mp4") !== -1) return ".mp4";
  if (mimeType.indexOf("mpeg") !== -1) return ".mp3";
  if (mimeType.indexOf("ogg") !== -1) return ".ogg";
  return ".webm";
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
