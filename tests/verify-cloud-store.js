"use strict";

const assert = require("node:assert/strict");

const bookId = "11111111-1111-4111-8111-111111111111";
const wordId = "22222222-2222-4222-8222-222222222222";
const rpcCalls = [];
const rows = {
  notebooks: [{ id: bookId, name: "英語 第1回", category: "english", created_at: "2026-01-01" }],
  words: [{ id: wordId, notebook_id: bookId, front: "impossible", back: "不可能な、ありえない", note: "", ocr_raw_meaning: "① 不可能な、ありえない ② どうしようもない", answer_candidates: ["不可能な", "ありえない"], created_at: "2026-01-01" }],
  review_items: [{ notebook_id: bookId, word_id: wordId }],
};

function query(table) {
  const result = () => Promise.resolve({ data: rows[table], error: null });
  return {
    select() { return this; },
    order() { return result(); },
    then(resolve, reject) { return result().then(resolve, reject); },
  };
}

global.window = global;
global.SUPABASE_CONFIG = {
  url: "https://demo.supabase.co",
  publishableKey: "sb_publishable_test_key_long_enough_for_validation",
};
global.supabase = {
  createClient() {
    return {
      auth: {},
      from: query,
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return { error: null };
      },
    };
  },
};

require("../cloud-store.js");

(async () => {
  assert.equal(KotobachoCloud.isConfigured(), true);
  KotobachoCloud.initialize();

  const loaded = await KotobachoCloud.loadData();
  assert.equal(loaded.notebooks.length, 1);
  assert.equal(loaded.notebooks[0].words[0].front, "impossible");
  assert.deepEqual(loaded.notebooks[0].words[0].answerCandidates, ["不可能な", "ありえない"]);
  assert.equal(loaded.notebooks[0].words[0].ocrRawMeaning, "① 不可能な、ありえない ② どうしようもない");
  assert.deepEqual(loaded.notebooks[0].reviewIds, [wordId]);

  const payload = KotobachoCloud.buildPayload(loaded, () => []);
  assert.deepEqual(payload.notebooks[0].words[0].answer_candidates, ["不可能な", "ありえない"]);
  assert.equal(payload.notebooks[0].words[0].ocr_raw_meaning, "① 不可能な、ありえない ② どうしようもない");
  assert.deepEqual(payload.notebooks[0].review_ids, [wordId]);

  loaded.notebooks[0].reviewIds.push("33333333-3333-4333-8333-333333333333");
  await KotobachoCloud.syncData(loaded, () => []);
  assert.equal(rpcCalls[0].name, "sync_user_data");
  assert.deepEqual(rpcCalls[0].args.payload.notebooks[0].review_ids, [wordId]);

  console.log("cloud-store tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
