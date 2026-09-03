"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const html = read("index.html");
const table = read("table-ocr.js");
const app = read("app.js");
const schema = read("supabase-schema.sql");

assert.match(html, /id="image-input"[^>]+accept="image\/\*,application\/pdf,\.pdf"/);
assert.match(html, /pdfjs-dist/);
assert.match(html, /ocr-image-processing\.js/);
assert.match(html, /id="ocr-preview-dialog"/);
assert.match(table, /loadPdf/);
assert.match(table, /countHorizontalRules/);
assert.match(table, /columnsForRow/);
assert.match(table, /deskewCanvas/);
assert.match(table, /prepareCell/);
assert.match(table, /createWorker\(\["jpn", "eng"\]/);
assert.match(table, /threshold: "otsu"/);
assert.match(table, /continuationUncertain/);
assert.match(table, /rawMeaning:/);
assert.match(app, /ocrRawMeaning/);
assert.match(schema, /ocr_raw_meaning text not null default ''/);

console.log("OCR architecture tests passed");
