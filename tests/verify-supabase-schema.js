"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase-schema.sql"), "utf8");
const tables = ["notebooks", "words", "review_items"];

for (const table of tables) {
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  for (const action of ["select", "insert", "update", "delete"]) {
    const policyPattern = new RegExp(`create policy[\\s\\S]+?on public\\.${table} for ${action}[\\s\\S]+?to authenticated`, "i");
    assert.match(sql, policyPattern, `${table} に ${action} 用のauthenticatedポリシーが必要です`);
  }
}

assert.match(sql, /auth\.uid\(\)/i);
assert.match(sql, /foreign key \(notebook_id, user_id\)[\s\S]+references public\.notebooks\(id, user_id\)/i);
assert.match(sql, /foreign key \(word_id, notebook_id, user_id\)[\s\S]+references public\.words\(id, notebook_id, user_id\)/i);
assert.match(sql, /security invoker/i);
assert.doesNotMatch(sql, /grant[\s\S]{0,120}service_role/i);
assert.match(sql, /revoke all on public\.notebooks, public\.words, public\.review_items from anon/i);

console.log("supabase schema security checks passed");
