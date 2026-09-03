(function () {
  "use strict";

  let client = null;
  let syncQueue = Promise.resolve();

  function getConfig() {
    return window.SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const config = getConfig();
    return /^https:\/\/.+\.supabase\.co\/?$/i.test(String(config.url || "").trim())
      && String(config.publishableKey || "").trim().length > 20;
  }

  function initialize() {
    if (client) return client;
    if (!isConfigured()) {
      throw new Error("SupabaseのURLとPublishable keyが未設定です。");
    }
    if (!window.supabase?.createClient) {
      throw new Error("Supabaseライブラリを読み込めませんでした。インターネット接続を確認してください。");
    }

    const config = getConfig();
    client = window.supabase.createClient(
      String(config.url).trim().replace(/\/$/, ""),
      String(config.publishableKey).trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
    return client;
  }

  function requireClient() {
    return client || initialize();
  }

  async function signUp(email, password) {
    const { data, error } = await requireClient().auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await requireClient().auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data, error } = await requireClient().auth.getSession();
    if (error) throw error;
    return data.session;
  }

  function onAuthStateChange(callback) {
    return requireClient().auth.onAuthStateChange(callback);
  }

  function throwIfError(result) {
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function loadWordRows(database) {
    let result = await database.from("words")
      .select("id,notebook_id,front,back,note,ocr_raw_meaning,answer_candidates,sort_index,created_at")
      .order("sort_index", { ascending: true });
    if (result.error && /ocr_raw_meaning/i.test(String(result.error.message || result.error.details || ""))) {
      result = await database.from("words")
        .select("id,notebook_id,front,back,note,answer_candidates,sort_index,created_at")
        .order("sort_index", { ascending: true });
    }
    return throwIfError(result);
  }

  async function loadData() {
    const database = requireClient();
    const [notebooksResult, wordRows, reviewResult] = await Promise.all([
      database.from("notebooks")
        .select("id,name,category,sort_index,created_at")
        .order("sort_index", { ascending: true }),
      loadWordRows(database),
      database.from("review_items")
        .select("notebook_id,word_id"),
    ]);

    const notebookRows = throwIfError(notebooksResult);
    const reviewRows = throwIfError(reviewResult);
    const wordsByNotebook = new Map();
    const reviewByNotebook = new Map();

    wordRows.forEach((row) => {
      if (!wordsByNotebook.has(row.notebook_id)) wordsByNotebook.set(row.notebook_id, []);
      wordsByNotebook.get(row.notebook_id).push({
        id: row.id,
        front: row.front,
        back: row.back,
        note: row.note || "",
        ocrRawMeaning: row.ocr_raw_meaning || "",
        answerCandidates: Array.isArray(row.answer_candidates)
          ? row.answer_candidates.filter(Boolean)
          : [],
      });
    });

    reviewRows.forEach((row) => {
      if (!reviewByNotebook.has(row.notebook_id)) reviewByNotebook.set(row.notebook_id, []);
      reviewByNotebook.get(row.notebook_id).push(row.word_id);
    });

    const notebooks = notebookRows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category === "classical" ? "classical" : "english",
      words: wordsByNotebook.get(row.id) || [],
      reviewIds: reviewByNotebook.get(row.id) || [],
    }));

    return {
      notebooks,
      activeNotebookId: notebooks[0]?.id || null,
    };
  }

  function buildPayload(data, makeAnswerCandidates) {
    return {
      notebooks: data.notebooks.map((notebook) => {
        const knownWordIds = new Set(notebook.words.map((word) => word.id));
        return {
          id: notebook.id,
          name: notebook.name,
          category: notebook.category,
          words: notebook.words.map((word) => {
            const candidates = Array.isArray(word.answerCandidates) && word.answerCandidates.length
              ? word.answerCandidates
              : makeAnswerCandidates(word.back, notebook.category);
            return {
              id: word.id,
              front: word.front,
              back: word.back,
              note: word.note || "",
              ocr_raw_meaning: word.ocrRawMeaning || "",
              answer_candidates: [...new Set(candidates.filter(Boolean))],
            };
          }),
          review_ids: (notebook.reviewIds || []).filter((id) => knownWordIds.has(id)),
        };
      }),
    };
  }

  function syncData(data, makeAnswerCandidates) {
    const payload = buildPayload(data, makeAnswerCandidates);
    syncQueue = syncQueue.catch(() => undefined).then(async () => {
      const { error } = await requireClient().rpc("sync_user_data", { payload });
      if (error) throw error;
    });
    return syncQueue;
  }

  function waitForPendingSync() {
    return syncQueue;
  }

  window.KotobachoCloud = Object.freeze({
    isConfigured,
    initialize,
    signUp,
    signIn,
    signOut,
    getSession,
    onAuthStateChange,
    loadData,
    syncData,
    waitForPendingSync,
    buildPayload,
  });
})();
