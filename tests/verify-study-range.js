"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ranges = require("../study-range-utils.js");

assert.equal(ranges.selectedNumbers({ mode: "fixed", preset: "all" }, 100).length, 100);
assert.deepEqual(ranges.selectedNumbers({ mode: "fixed", preset: "1-25" }, 100), Array.from({ length: 25 }, (_, index) => index + 1));
assert.deepEqual(ranges.selectedNumbers({ mode: "fixed", preset: "76-100" }, 80), [76, 77, 78, 79, 80]);
assert.deepEqual(ranges.selectedNumbers({ mode: "fixed", preset: "76-100" }, 60), []);
assert.equal(ranges.rangeNumbers({ start: "21", end: "40" }, 100).length, 20);
assert.deepEqual(ranges.rangeNumbers({ start: "40", end: "21" }, 100), []);

const overlapping = ranges.selectedNumbers({
  mode: "ranges",
  ranges: [
    { start: "1", end: "10" },
    { start: "5", end: "15" },
    { start: "21", end: "30" },
  ],
}, 100);
assert.equal(overlapping.length, 25);
assert.deepEqual(overlapping.slice(0, 15), Array.from({ length: 15 }, (_, index) => index + 1));

assert.deepEqual(ranges.selectedNumbers({ mode: "individual", numbers: new Set([3, 7, 12, 20]) }, 100), [3, 7, 12, 20]);
assert.deepEqual(ranges.selectedNumbers({ mode: "individual", numbers: new Set([0, 1, 101]) }, 100), [1]);

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
assert.match(html, />全単語</);
assert.match(html, />1〜25</);
assert.match(html, />26〜50</);
assert.match(html, />51〜75</);
assert.match(html, />76〜100</);
assert.match(html, /data-number-action="all"[^>]*>すべて選択</);
assert.match(html, /data-number-action="clear"[^>]*>すべて解除</);
assert.match(html, /data-number-action="invert"[^>]*>選択を反転</);
assert.match(app, /type="number" inputmode="numeric"/);
assert.match(app, /selectedStudyWords\(book\)/);
assert.doesNotMatch(html, /1-10,15|範囲を記号/);

console.log("study range selection tests passed");
