(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OcrJapanese = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const JAPANESE = /[ぁ-んァ-ン一-龯々ゝゞー]/;
  const POS_LABEL = /^(?:名|名詞|動|動詞|形|形容詞|形動|副|副詞|前|前置詞|接|接続詞|代|代名詞|冠|冠詞|熟|熟語|句|自|他|自動詞|他動詞)$/;

  function preserveRawText(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim();
  }

  function bracketBalance(value) {
    const pairs = [["（", "）"], ["(", ")"], ["【", "】"], ["≪", "≫"], ["〈", "〉"], ["《", "》"], ["「", "」"], ["『", "』"]];
    return pairs.every(([open, close]) => value.split(open).length === value.split(close).length);
  }

  function isRemovableLeadingNote(content) {
    const normalized = String(content || "").normalize("NFKC").trim();
    if (!normalized) return false;
    if (/[A-Za-z]/.test(normalized)) return true;
    if (/^(?:通常|通例|主に|俗に|比喩的に|文語で|口語で|日|米|英|数|文|口|古)$/.test(normalized)) return true;
    if (/(?:性質|立場|人|物|事|場合|意味|用法|語法|文脈)/.test(normalized)) return true;
    if (/[がはをにでとのへ]$/.test(normalized)) return true;
    return false;
  }

  function stripLeadingPartOfSpeech(value, reasons, removed) {
    let output = value;
    for (let count = 0; count < 3; count++) {
      const match = output.match(/^\s*(?:【([^】]{1,12})】|≪([^≫]{1,12})≫|《([^》]{1,12})》)\s*/);
      if (!match) break;
      const label = String(match[1] || match[2] || match[3] || "").normalize("NFKC").replace(/[.．\s]/g, "");
      if (!POS_LABEL.test(label)) {
        reasons.push("先頭の分類記号を自動判定できない");
        break;
      }
      removed.push(match[0].trim());
      output = output.slice(match[0].length);
    }
    return output;
  }

  function stripLeadingNotes(value, reasons, removed) {
    let output = value;
    for (let count = 0; count < 4; count++) {
      const match = output.match(/^\s*[（(]([^）)]{1,100})[）)]\s*/);
      if (!match) break;
      if (!isRemovableLeadingNote(match[1])) {
        reasons.push("括弧内が意味か補足か自動判定できない");
        break;
      }
      removed.push(match[0].trim());
      output = output.slice(match[0].length);
    }
    return output;
  }

  function cleanMeaningSpacing(value) {
    return String(value || "")
      .replace(/([ぁ-んァ-ン一-龯々ゝゞー])\s+(?=[ぁ-んァ-ン一-龯々ゝゞー、，,])/g, "$1")
      .replace(/[\s　]+/g, " ")
      .replace(/\s*([、，,])\s*/g, "$1")
      .replace(/^[\s:：、，,・･©〇○@-]+|[\s:：、，,・･©〇○@-]+$/g, "")
      .trim();
  }

  function analyzeMeaning(value) {
    const raw = preserveRawText(value);
    const reasons = [];
    const removedAnnotations = [];
    if (!raw) return { raw, meaning: "", uncertain: true, reasons: ["OCR原文が空欄"], removedAnnotations };

    if (!bracketBalance(raw)) reasons.push("括弧の対応が崩れている");
    let working = raw.replace(/\n+/g, " ").trim();
    working = working.replace(/^[\s©〇○@DＯO0)）]+(?=[ぁ-んァ-ン一-龯々ゝゞー（(【≪《])/, "");
    working = working.replace(/^\s*(?:[①-⑳]|1\s*[.．、])\s*/, "");
    working = working.split(/\s*(?:[②-⑳]|(?:[2-9]|1\d|20)\s*[.．、])\s*/)[0];
    working = stripLeadingPartOfSpeech(working, reasons, removedAnnotations);
    working = stripLeadingNotes(working, reasons, removedAnnotations);
    const meaning = cleanMeaningSpacing(working);

    if (!meaning) reasons.push("補足除去後の意味が空欄");
    const comparable = meaning.replace(/[\s、。，．,.・･/／()（）【】≪≫「」『』]/g, "");
    if (comparable && ![...comparable].some(char => JAPANESE.test(char))) reasons.push("日本語の意味を確認できない");
    const rawComparableLength = raw.replace(/\s/g, "").length;
    if (rawComparableLength >= 6 && meaning.length / rawComparableLength < 0.22) reasons.push("補足除去量が大きい");

    return {
      raw,
      meaning,
      uncertain: reasons.length > 0,
      reasons: [...new Set(reasons)],
      removedAnnotations,
    };
  }

  return Object.freeze({ preserveRawText, analyzeMeaning, bracketBalance, isRemovableLeadingNote });
});
