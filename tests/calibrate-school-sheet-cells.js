"use strict";

// 開発時の前処理比較用。アプリ本体は座標を固定せず、表の罫線から同じセルを検出する。
const path = require("node:path");
const sharp = require("sharp");
const { createWorker, PSM } = require("tesseract.js");

const root = path.resolve(__dirname, "..");
const source = process.env.SOURCE_IMAGE || "C:/Users/jin-s/OneDrive/ドキュメント/S__32555010.jpg";
const langPath = process.env.TESSDATA_DIR || root;
const cells = [
  { word: "impossible", y: 66 },
  { word: "direction", y: 134 },
  { word: "shade", y: 790 },
];
const variants = [
  { name: "gray4", scale: 4, normalize: false, threshold: null, sharpen: 0.8 },
  { name: "gray5-normal", scale: 5, normalize: true, threshold: null, sharpen: 1.0 },
  { name: "gray8", scale: 8, normalize: false, threshold: null, sharpen: 1.0 },
  { name: "threshold5-185", scale: 5, normalize: true, threshold: 185, sharpen: 0.8 },
];

async function cellBuffer(left, top, width, height, variant) {
  let pipeline = sharp(source).extract({ left, top, width, height }).grayscale();
  if (variant.normalize) pipeline = pipeline.normalize();
  pipeline = pipeline.sharpen({ sigma: variant.sharpen }).resize({ width: width * variant.scale, height: height * variant.scale, kernel: "lanczos3" });
  if (variant.threshold) pipeline = pipeline.threshold(variant.threshold);
  return pipeline.extend({ top: 25, bottom: 25, left: 25, right: 25, background: "white" }).png().toBuffer();
}

(async () => {
  const english = await createWorker("eng", 1, { langPath, gzip: false });
  const japanese = await createWorker(["jpn", "eng"], 1, { langPath, gzip: false });
  await english.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'-" });
  await japanese.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: "1" });
  try {
    for (const cell of cells) {
      const output = { expected: cell.word, attempts: [] };
      for (const variant of variants) {
        const wordImage = await cellBuffer(878, cell.y + 2, 116, 14, variant);
        const meaningImage = await cellBuffer(998, cell.y + 2, 438, 14, variant);
        const [word, meaning] = await Promise.all([english.recognize(wordImage), japanese.recognize(meaningImage)]);
        output.attempts.push({ name: variant.name, word: word.data.text.trim(), wordConfidence: word.data.confidence, meaning: meaning.data.text.trim(), meaningConfidence: meaning.data.confidence });
      }
      console.log(JSON.stringify(output, null, 2));
    }
  } finally {
    await english.terminate();
    await japanese.terminate();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
