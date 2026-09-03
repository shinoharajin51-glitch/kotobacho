"use strict";

// 任意実行の実画像回帰テスト。学校プリントを変更したら SOURCE_IMAGE を差し替えて再利用できる。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { chromium } = require("playwright");

const source = process.env.SOURCE_IMAGE || "C:/Users/jin-s/OneDrive/ドキュメント/S__32555010.jpg";
const baseUrl = process.env.APP_URL || "http://127.0.0.1:8766/";

async function makePortraitCrop(input, output, yStart, yEnd) {
  const metadata = await sharp(input).metadata();
  const left = Math.round(metadata.width * 0.52);
  const top = Math.round(metadata.height * yStart);
  const width = Math.round(metadata.width * 0.44);
  const height = Math.round(metadata.height * (yEnd - yStart));
  const targetHeight = Math.ceil(width * 1.38);
  const bottom = Math.max(0, targetHeight - height);
  await sharp(input)
    .extract({ left, top, width, height })
    .extend({ top: 10, bottom, left: 0, right: 0, background: "white" })
    .jpeg({ quality: 96 })
    .toFile(output);
}

(async () => {
  assert.equal(fs.existsSync(source), true, `実画像がありません: ${source}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kotobacho-ocr-"));
  const upper = path.join(temporary, "upper.jpg");
  const lower = path.join(temporary, "lower.jpg");
  await makePortraitCrop(source, upper, 0.045, 0.33);
  await makePortraitCrop(source, lower, 0.60, 0.89);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
  try {
    const page = await browser.newPage();
    page.on("console", message => {
      if (message.type() === "error") console.error("browser:", message.text());
    });
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => window.TableOcr && window.OcrJapanese && window.Tesseract, null, { timeout: 60000 });
    await page.locator("#image-input").setInputFiles([upper, lower]);
    if (process.env.LAYOUT_ONLY === "1") {
      const layout = await page.evaluate(async () => window.TableOcr.inspectLayout(document.querySelector("#image-input").files[0]));
      console.log(JSON.stringify(layout, null, 2));
      return;
    }
    const rows = await page.evaluate(async () => {
      const files = [...document.querySelector("#image-input").files];
      return window.TableOcr.extract(files, {
        analyzeMeaning: value => window.OcrJapanese.analyzeMeaning(value),
        includeDebugCandidates: true,
        onProgress: progress => { window.__lastOcrProgress = progress.message; },
      });
    });
    const targets = ["impossible", "direction", "shade"].map(word => {
      const row = rows.find(item => item.front === word);
      return row ? { word, rawMeaning: row.rawMeaning, meaning: row.back, status: row.status, confidence: row.confidence, candidates: row.ocrCandidates } : { word, missing: true };
    });
    console.log(JSON.stringify({ rowCount: rows.length, targets, rows: rows.map(row => ({ front: row.front, rawMeaning: row.rawMeaning, meaning: row.back, status: row.status })) }, null, 2));
    for (const result of targets) {
      assert.equal(result.missing, undefined, `${result.word} を抽出できませんでした`);
      assert.ok(result.rawMeaning, `${result.word} のOCR原文が空です`);
      assert.ok(result.meaning, `${result.word} の登録用の意味が空です`);
    }
  } finally {
    await browser.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
