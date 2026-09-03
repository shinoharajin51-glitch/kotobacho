"use strict";

const assert = require("node:assert/strict");
const Japanese = require("../ocr-japanese.js");

const cases = [
  ["① 不可能な、ありえない ② どうしようもない", "不可能な、ありえない"],
  ["① 指揮、管理 ② 方向 ③ 方針", "指揮、管理"],
  ["（通常 the shade で）(日)陰 ② 日よけ", "陰"],
  ["（性質・立場が）正反対の、逆の\n② 向かい側の、反対側の", "正反対の、逆の"],
  ["【名】方向", "方向"],
  ["≪名詞≫ 情報、知識", "情報、知識"],
  ["（日）陰", "陰"],
];

for (const [raw, expected] of cases) {
  const result = Japanese.analyzeMeaning(raw);
  assert.equal(result.raw, raw, `OCR原文を保持: ${raw}`);
  assert.equal(result.meaning, expected, `登録用の意味: ${raw}`);
}

assert.equal(Japanese.analyzeMeaning("（意味の一部）").uncertain, true, "意味か補足か不明な括弧は要確認");
assert.equal(Japanese.analyzeMeaning("【名 方向").uncertain, true, "壊れた括弧は要確認");
assert.equal(Japanese.bracketBalance("【名】方向（方角）"), true);
assert.equal(Japanese.bracketBalance("【名 方向"), false);

console.log("Japanese OCR post-processing tests passed");
