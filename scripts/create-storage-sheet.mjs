import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const outputDir = path.join(root, "tmp");
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const prayers = workbook.worksheets.add("Prayers");
const areas = workbook.worksheets.add("Areas");
const moderation = workbook.worksheets.add("ModerationLog");

prayers.getRange("A1:K1").values = [[
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
]];

areas.getRange("A1:F1").values = [[
  "areaId",
  "mapId",
  "areaName",
  "conditionsScore",
  "population",
  "areaSqMiles",
]];

moderation.getRange("A1:H1").values = [[
  "id",
  "areaId",
  "submittedText",
  "decision",
  "reason",
  "createdAt",
  "model",
  "source",
]];

const geojson = JSON.parse(await fs.readFile(path.join(root, "data", "tulsa-nsa.geojson"), "utf8"));
const areaRows = geojson.features
  .map((feature) => {
    const props = feature.properties;
    return [
      `nsa-${props.Map_ID}`,
      props.Map_ID,
      props.Neighorhood,
      props.Overall_Score,
      props.Population,
      props.Area_Sq_Miles,
    ];
  })
  .sort((a, b) => a[1] - b[1]);

areas.getRange(`A2:F${areaRows.length + 1}`).values = areaRows;

for (const sheet of [prayers, areas, moderation]) {
  sheet.getRange("A1:K1").format = {
    fill: "#0B3D3D",
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
}

prayers.getRange("A:K").format.columnWidthPx = 150;
areas.getRange("A:F").format.columnWidthPx = 150;
moderation.getRange("A:H").format.columnWidthPx = 160;

const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "tulsaprayer-storage.xlsx");
await output.save(outputPath);
console.log(outputPath);
