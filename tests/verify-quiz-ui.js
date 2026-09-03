"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

assert.match(app, /id="end-quiz"[^>]*>テストを終了</);
assert.match(app, /テストを終了しますか？\\nここまでの復習対象は保存されます。/);
assert.match(app, /if \(!correct[\s\S]{0,180}reviewIds\.unshift\(quizWord\.id\)[\s\S]{0,60}saveData\(\)/);
assert.match(app, /function endQuiz[\s\S]{0,420}saveData\(\);[\s\S]{0,120}closeQuiz/);
assert.match(app, /nav[\s\S]{0,180}!quiz\.completed[\s\S]{0,120}endQuiz/);

assert.match(css, /\.button \{[^}]*min-height:48px/);
assert.match(css, /input,textarea,select \{[^}]*min-height:50px/);
assert.match(css, /\.nav-button \{[^}]*min-width:96px[^}]*min-height:52px/);
assert.match(css, /\.question \{[^}]*font-size:clamp\(2rem/);
assert.match(css, /\.selfcheck-actions \.button \{[^}]*min-height:66px/);
assert.match(css, /\.quiz-topbar \{[^}]*position:sticky/);

console.log("quiz interruption and touch UI checks passed");
