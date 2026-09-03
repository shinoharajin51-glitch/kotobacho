(() => {
  const STORAGE_KEY = "kotobacho-data-v2";
  const LEGACY_STORAGE_KEY = "kotobacho-data-v1";
  const MIGRATION_KEY_PREFIX = "kotobacho-cloud-migrated-";
  const emptyData = { notebooks: [], activeNotebookId: null };
  const localDataForMigration = loadLocalData();
  let data = structuredClone(emptyData);
  let settings = { notebookId: null, direction: "forward", mode: "typing" };
  let studySelection = { bookId: null, mode: "fixed", preset: "all", ranges: [], numbers: new Set() };
  let currentUser = null;
  let cloudReady = false;
  let authLoadVersion = 0;
  let saveVersion = 0;
  let quiz = null;
  let selectedImages = [];
  let importRows = [];
  const $ = (selector) => document.querySelector(selector);
  const categoryName = (category) => category === "english" ? "英単語" : "古文単語";
  const labels = (category) => category === "english"
    ? { front: "英語", back: "日本語の意味", forward: "英語 → 日本語", reverse: "日本語 → 英語", frontPlaceholder: "例: diligent", backPlaceholder: "例: 勤勉な" }
    : { front: "古文", back: "意味", forward: "古文 → 意味", reverse: "意味 → 古文", frontPlaceholder: "例: をかし", backPlaceholder: "例: 趣がある、すばらしい" };
  const rangePresets = window.StudyRangeUtils.PRESETS;

  function newStudyRange(start = "", end = "") {
    return { id: crypto.randomUUID(), start: String(start), end: String(end) };
  }

  function ensureStudySelection(book) {
    if (!book || studySelection.bookId === book.id) return;
    studySelection = {
      bookId: book.id,
      mode: "fixed",
      preset: "all",
      ranges: [newStudyRange(1, Math.min(25, book.words.length || 1))],
      numbers: new Set(),
    };
  }

  function selectedStudyNumbers(book) {
    return book?.words.length ? window.StudyRangeUtils.selectedNumbers(studySelection, book.words.length) : [];
  }

  function selectedStudyWords(book) {
    return selectedStudyNumbers(book).map(number => book.words[number - 1]).filter(Boolean);
  }

  function loadLocalData() {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (current?.notebooks) return normalizeData(current);
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
      return migrateLegacyData(legacy);
    } catch { return structuredClone(emptyData); }
  }
  function normalizeData(value) {
    const notebooks = Array.isArray(value.notebooks) ? value.notebooks.map(book => ({
      id: book.id || crypto.randomUUID(), name: book.name || "名称未設定", category: book.category === "classical" ? "classical" : "english",
      words: Array.isArray(book.words) ? book.words.map(word => ({ id: word.id || crypto.randomUUID(), front: word.front || "", back: word.back || "", note: word.note || "", ocrRawMeaning: word.ocrRawMeaning || "", answerCandidates: Array.isArray(word.answerCandidates) ? word.answerCandidates.filter(Boolean) : [] })) : [],
      reviewIds: Array.isArray(book.reviewIds) ? book.reviewIds : []
    })) : [];
    return { notebooks, activeNotebookId: notebooks.some(book => book.id === value.activeNotebookId) ? value.activeNotebookId : notebooks[0]?.id || null };
  }
  function migrateLegacyData(legacy) {
    if (!legacy?.words?.length) return structuredClone(emptyData);
    const notebooks = ["english", "classical"].map(category => {
      const words = legacy.words.filter(word => word.category === category).map(word => ({ id: word.id || crypto.randomUUID(), front: word.front || "", back: word.back || "", note: word.note || "" }));
      const reviewIds = (legacy.reviewIds || []).filter(id => words.some(word => word.id === id));
      return words.length ? { id: crypto.randomUUID(), name: category === "english" ? "これまでの英単語" : "これまでの古文単語", category, words, reviewIds } : null;
    }).filter(Boolean);
    return { notebooks, activeNotebookId: notebooks[0]?.id || null };
  }
  function setCloudStatus(message, kind = "info") {
    const status = $("#cloud-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }
  function setAuthStatus(message, kind = "info") {
    const status = $("#auth-status");
    status.textContent = message;
    status.dataset.kind = kind;
  }
  function friendlyError(error) {
    const message = String(error?.message || error || "不明なエラー");
    if (/invalid login credentials/i.test(message)) return "メールアドレスまたはパスワードが正しくありません。";
    if (/email not confirmed/i.test(message)) return "確認メール内のリンクを開いてからログインしてください。";
    if (/user already registered/i.test(message)) return "このメールアドレスはすでに登録されています。";
    if (/password should be at least/i.test(message)) return "パスワードを6文字以上にしてください。";
    if (/failed to fetch|network/i.test(message)) return "Supabaseに接続できません。インターネット接続と設定値を確認してください。";
    return message;
  }
  function saveData() {
    renderAll();
    if (!cloudReady || !currentUser) return;
    const version = ++saveVersion;
    setCloudStatus("保存中...", "working");
    window.KotobachoCloud.syncData(data, answerCandidates)
      .then(() => {
        if (version === saveVersion) setCloudStatus("クラウド保存済み", "success");
      })
      .catch(error => {
        console.error("Cloud save failed", error);
        if (version === saveVersion) setCloudStatus(`保存エラー: ${friendlyError(error)}`, "error");
        showToast("クラウド保存に失敗しました。「再読込」で接続を確認してください。");
      });
  }
  function activeBook() { return data.notebooks.find(book => book.id === data.activeNotebookId) || null; }
  function bookById(id) { return data.notebooks.find(book => book.id === id) || null; }
  function wordById(book, id) { return book?.words.find(word => word.id === id) || null; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#039;", '"':"&quot;" })[char]); }
  function normalize(value) {
    return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en")
      .replace(/[\s　]+/g, "").replace(/[、。，．,.・･/／\\'"“”‘’「」『』()（）\[\]【】≪≫〈〉《》〔〕｛｝{}：:;；!?！？]/g, "");
  }
  function firstMeaning(value) {
    return window.OcrJapanese.analyzeMeaning(value).meaning;
  }
  function answerCandidates(answer, category) {
    const first = firstMeaning(answer);
    const candidates = new Set([first]);
    if (category === "classical") candidates.add(answer);
    first.split(/[、，,／/・･]/).map(part => part.trim()).filter(Boolean).forEach(part => candidates.add(part));
    if (normalize(first) === normalize("陰")) candidates.add("日陰");
    return [...candidates].map(normalize).filter(Boolean);
  }
  function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200); }
  function selectBook(id) { data.activeNotebookId = id; settings.notebookId = id; resetWordForm(); saveData(); }
  function goTo(view) { document.querySelectorAll(".view").forEach(node => node.classList.toggle("active", node.id === `${view}-view`)); document.querySelectorAll(".nav-button").forEach(node => node.classList.toggle("active", node.dataset.view === view)); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function renderAll() { renderNotebooks(); renderWords(); renderStudySetup(); renderReview(); renderSelectedImages(); renderImportRows(); }
  function renderNotebooks() {
    const list = $("#notebook-list");
    list.innerHTML = data.notebooks.length ? data.notebooks.map(book => `<article class="notebook-card ${book.id === data.activeNotebookId ? "selected" : ""}"><button class="notebook-select" data-select-book="${book.id}" type="button"><span class="tag ${book.category === "classical" ? "classical" : ""}">${categoryName(book.category)}</span><strong>${escapeHtml(book.name)}</strong><small>${book.words.length}語</small></button><div class="notebook-actions"><button class="mini-button" data-edit-book="${book.id}" type="button">名前を変更</button><button class="mini-button danger" data-delete-book="${book.id}" type="button">削除</button></div></article>`).join("") : `<div class="empty-state">まだ単語帳がありません。<br>左のフォームから作成してください。</div>`;
  }
  function renderWords() {
    const book = activeBook(); const editor = $("#word-editor"); const empty = $("#no-selected-notebook");
    editor.classList.toggle("hidden", !book); empty.classList.toggle("hidden", Boolean(book));
    if (!book) { $("#selected-notebook-description").textContent = "単語帳を選択してください。"; return; }
    const text = labels(book.category); $("#selected-notebook-description").textContent = `「${book.name}」の${categoryName(book.category)}を編集しています。`;
    $("#front-label").childNodes[0].nodeValue = text.front; $("#back-label").childNodes[0].nodeValue = text.back;
    $("#word-front").placeholder = text.frontPlaceholder; $("#word-back").placeholder = text.backPlaceholder; $("#word-total").textContent = `${book.words.length}語`;
    $("#word-list").innerHTML = book.words.length ? book.words.map(word => `<article class="word-row"><div class="word-main"><strong class="word-term">${escapeHtml(word.front)}</strong><span class="word-meaning">${escapeHtml(word.back)}</span>${word.note ? `<span class="word-meta">${escapeHtml(word.note)}</span>` : ""}</div><div class="row-actions"><button class="icon-button" data-edit-word="${word.id}" type="button" aria-label="${escapeHtml(word.front)}を編集">編集</button><button class="icon-button delete" data-delete-word="${word.id}" type="button" aria-label="${escapeHtml(word.front)}を削除">削除</button></div></article>`).join("") : `<div class="empty-state">まだ単語がありません。左のフォームから追加してください。</div>`;
  }
  function rangePreviewText(range, total) {
    const start = Number.parseInt(range.start, 10);
    const end = Number.parseInt(range.end, 10);
    if (!range.start || !range.end) return "開始番号と終了番号を入力してください";
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return "開始番号は終了番号以下にしてください";
    if (start > total) return `この単語帳は${total}語までです`;
    const actualEnd = Math.min(end, total);
    return `${start}〜${actualEnd}：${actualEnd - start + 1}語`;
  }

  function updateStudySelectionUi(book) {
    if (!book) return;
    const total = book.words.length;
    document.querySelectorAll("[data-range-mode]").forEach(button => {
      const selected = button.dataset.rangeMode === studySelection.mode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    $("#fixed-range-panel").classList.toggle("hidden", studySelection.mode !== "fixed");
    $("#continuous-range-panel").classList.toggle("hidden", studySelection.mode !== "ranges");
    $("#individual-range-panel").classList.toggle("hidden", studySelection.mode !== "individual");

    document.querySelectorAll("[data-range-preset]").forEach(button => {
      const selected = studySelection.mode === "fixed" && button.dataset.rangePreset === studySelection.preset;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      const bounds = rangePresets[button.dataset.rangePreset];
      button.disabled = Boolean(bounds && bounds[0] > total);
    });
    document.querySelectorAll("[data-study-number]").forEach(button => {
      const number = Number(button.dataset.studyNumber);
      const selected = studySelection.numbers.has(number);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    studySelection.ranges.forEach(range => {
      const preview = document.querySelector(`[data-range-preview="${range.id}"]`);
      if (preview) preview.textContent = rangePreviewText(range, total);
    });

    const count = selectedStudyNumbers(book).length;
    $("#study-selection-summary").innerHTML = `<span>出題数</span><strong>${count}語</strong>`;
    $("#start-study-button").disabled = count === 0;
    $("#start-study-button").textContent = count ? `${count}語でテストを始める` : "出題範囲を選んでください";
  }

  function renderStudyRangePicker(book) {
    ensureStudySelection(book);
    const total = book.words.length;
    $("#study-range-list").innerHTML = studySelection.ranges.length ? studySelection.ranges.map((range, index) => `<div class="study-range-row" data-study-range-row="${range.id}"><div class="range-row-heading"><strong>範囲${index + 1}</strong><button class="mini-button danger" data-remove-study-range="${range.id}" type="button">削除</button></div><div class="range-inputs"><label>開始番号<input type="number" inputmode="numeric" min="1" max="${total}" step="1" value="${escapeHtml(range.start)}" data-range-start="${range.id}" aria-label="範囲${index + 1}の開始番号" /></label><span aria-hidden="true">〜</span><label>終了番号<input type="number" inputmode="numeric" min="1" max="${total}" step="1" value="${escapeHtml(range.end)}" data-range-end="${range.id}" aria-label="範囲${index + 1}の終了番号" /></label></div><p class="range-preview" data-range-preview="${range.id}"></p></div>`).join("") : `<div class="range-empty">「範囲を追加」を押してください。</div>`;
    $("#study-number-grid").innerHTML = Array.from({ length: total }, (_, index) => { const number = index + 1; const term = book.words[index]?.front || ""; return `<button class="number-select-button" data-study-number="${number}" type="button" aria-pressed="false" aria-label="${number}番 ${escapeHtml(term)}" title="${number}. ${escapeHtml(term)}">${number}</button>`; }).join("");
    updateStudySelectionUi(book);
  }

  function renderStudySetup() {
    const select = $("#study-notebook-select"); const prior = settings.notebookId;
    select.innerHTML = data.notebooks.length ? data.notebooks.map(book => `<option value="${book.id}">${escapeHtml(book.name)}（${categoryName(book.category)}）</option>`).join("") : `<option value="">単語帳がありません</option>`;
    settings.notebookId = bookById(prior)?.id || data.activeNotebookId || data.notebooks[0]?.id || null; select.value = settings.notebookId || "";
    const book = bookById(settings.notebookId); const detail = $("#study-book-detail");
    $("#study-range-picker").classList.toggle("hidden", !book);
    if (!book) { detail.textContent = "単語帳を作成するとテストできます。"; $("#study-direction").innerHTML = ""; $("#start-study-button").disabled = true; $("#start-study-button").textContent = "テストを始める"; return; }
    const text = labels(book.category); detail.innerHTML = `<span class="tag ${book.category === "classical" ? "classical" : ""}">${categoryName(book.category)}</span> 全${book.words.length}語`;
    renderStudyRangePicker(book);
    $("#study-direction").innerHTML = `<button class="choice-button ${settings.direction === "forward" ? "selected" : ""}" data-direction="forward" type="button">${text.forward}</button><button class="choice-button ${settings.direction === "reverse" ? "selected" : ""}" data-direction="reverse" type="button">${text.reverse}</button>`;
    $("#study-mode").querySelectorAll("button").forEach(button => button.classList.toggle("selected", button.dataset.mode === settings.mode));
  }
  function renderReview() {
    const book = activeBook(); const content = $("#review-content");
    if (!book) { $("#review-description").textContent = "単語帳を選択してください。"; content.innerHTML = `<div class="empty-state">単語帳を選ぶと、その単語帳の復習リストを見られます。</div>`; return; }
    const reviewWords = book.reviewIds.map(id => wordById(book, id)).filter(Boolean);
    $("#review-description").textContent = `「${book.name}」で「覚えてない」を選んだ単語です。`;
    content.innerHTML = reviewWords.length ? `<div class="review-toolbar"><strong>${reviewWords.length}語</strong><button id="review-start" class="button primary small-button" type="button">復習テストを始める</button></div><div class="review-list">${reviewWords.map(word => `<article class="review-row"><div><strong>${escapeHtml(word.front)}</strong><span> — ${escapeHtml(word.back)}</span></div><button class="button ghost small-button" data-remove-review="${word.id}" type="button">リストから外す</button></article>`).join("")}</div>` : `<div class="empty-state">「覚えてない」を選んだ単語はありません。</div>`;
  }
  function renderSelectedImages() {
    $("#selected-images").innerHTML = selectedImages.length ? selectedImages.map((file, index) => `<div class="selected-image"><span>${index + 1}. ${escapeHtml(file.name)}</span><small>${Math.max(1, Math.round(file.size / 1024))} KB</small><button data-remove-image="${index}" type="button" aria-label="${escapeHtml(file.name)}を外す">×</button></div>`).join("") : `<p class="muted">選択されている画像はありません。</p>`;
    $("#run-ocr-button").disabled = !selectedImages.length;
  }
  function setOcrStatus(message, kind = "info") {
    const status = $("#ocr-status");
    status.textContent = message;
    status.dataset.kind = kind;
  }
  function importRowStatus(row) {
    return row.status || (row.needsReview ? "needs_review" : row.confidence == null ? "edited" : "ocr_ok");
  }
  function importStatusHtml(row, index) {
    const status = importRowStatus(row);
    if (status === "needs_review") return `<span class="review-badge">要確認</span><button class="mini-button" data-confirm-import-row="${index}" type="button">確認済みにする</button>`;
    if (status === "edited") return `<span class="edited-badge">修正済み</span>`;
    if (status === "confirmed") return `<span class="confirmed-badge">確認済み</span>`;
    return `<span class="ok-badge">OK</span>`;
  }
  function updateImportControls() {
    const reviewCount = importRows.filter(row => importRowStatus(row) === "needs_review" || !row.front.trim() || !row.back.trim()).length;
    $("#import-count").textContent = `${importRows.length}語${reviewCount ? `・要確認 ${reviewCount}件` : ""}`;
    $("#confirm-all-import").disabled = !importRows.some(row => importRowStatus(row) === "needs_review" && row.front.trim() && row.back.trim());
    $("#create-from-import").disabled = !importRows.length || reviewCount > 0;
  }
  function renderImportRows() {
    const root = $("#import-results");
    root.innerHTML = importRows.length ? importRows.map((row, index) => {
      const status = importRowStatus(row);
      const preview = row.sourceImage ? `<div class="import-source-preview"><span>元画像（タップで拡大）</span><button class="source-preview-button" data-open-ocr-preview="${index}" type="button" aria-label="${index + 1}行目の元画像を拡大"><img src="${row.sourceImage}" alt="${index + 1}行目の元画像" loading="lazy" /></button></div>` : "";
      const quality = row.confidence == null ? "手入力" : `OCR信頼度 ${row.confidence}%`;
      return `<article class="import-row ${status === "needs_review" ? "needs-review" : status === "edited" ? "edited-row" : ""}" data-import-index="${index}">${preview}<span class="row-number">${index + 1}</span><div class="import-field import-front-field"><small>見出し語</small><input data-import-front="${index}" value="${escapeHtml(row.front)}" aria-label="${index + 1}行目の見出し語" placeholder="見出し語" /></div><div class="import-field import-raw-field"><small>OCRした日本語原文</small><textarea rows="2" data-import-raw="${index}" aria-label="${index + 1}行目のOCR原文" placeholder="括弧や記号を含むOCR原文">${escapeHtml(row.rawMeaning ?? row.back)}</textarea></div><div class="import-field import-back-field"><small>登録する意味</small><input data-import-back="${index}" value="${escapeHtml(row.back)}" aria-label="${index + 1}行目の登録する意味" placeholder="単語テストで使う意味" /></div><div class="import-quality"><div class="import-status-control">${importStatusHtml(row, index)}</div><small>${quality}${row.validationSummary ? `<br>${escapeHtml(row.validationSummary)}` : ""}${status === "needs_review" && row.reviewReason ? `<br>${escapeHtml(row.reviewReason)}` : ""}<br>${escapeHtml(row.source || "")}</small></div><button class="icon-button delete" data-remove-import-row="${index}" type="button" aria-label="${index + 1}行目を削除">削除</button></article>`;
    }).join("") : `<div class="empty-state">読み取った単語がここに表示されます。</div>`;
    updateImportControls();
  }
  function parseOcrLines(lines, category) {
    const rows = []; let pendingFront = "";
    for (const rawLine of lines) {
      let line = String(rawLine ?? "").replace(/\s+/g, " ").trim();
      if (!line || /^(?:No\.?|番号|見出し語|意味|単語|word|meaning)$/i.test(line)) continue;
      line = line.replace(/^\s*(?:No\.?\s*)?\d+\s*[.．、:：]?\s*/, "").trim();
      if (!line) continue;
      const match = category === "classical"
        ? line.match(/^([ぁ-んァ-ン一-龯々ゝゞー]{1,30})\s+(.+)$/)
        : line.match(/^([A-Za-z][A-Za-z'’\- ]{0,50})\s+(.+)$/);
      if (match) { rows.push({ front: match[1].trim(), rawMeaning: match[2].trim(), back: firstMeaning(match[2]) }); pendingFront = ""; continue; }
      const isHeadwordOnly = category === "classical" ? /^[ぁ-んァ-ン一-龯々ゝゞー]{1,30}$/.test(line) : /^[A-Za-z][A-Za-z'’\- ]{0,50}$/.test(line);
      if (isHeadwordOnly) { pendingFront = line.trim(); continue; }
      if (pendingFront) { rows.push({ front: pendingFront, rawMeaning: line, back: firstMeaning(line) }); pendingFront = ""; }
    }
    return rows.filter(row => row.front && row.back);
  }
  async function runOcr() {
    if (!selectedImages.length) { setOcrStatus("画像・PDFが選択されていません。「単語表の画像・PDFを選択」を押してください。", "error"); return; }
    if (!window.Tesseract || !window.TableOcr) { setOcrStatus("OCRライブラリを読み込めませんでした。インターネット接続を確認して、アプリを再読み込みしてください。", "error"); return; }
    $("#run-ocr-button").disabled = true; $("#create-from-import").disabled = true; importRows = [];
    try {
      importRows = await window.TableOcr.extract(selectedImages, {
        cleanMeaning: firstMeaning,
        analyzeMeaning: value => window.OcrJapanese.analyzeMeaning(value),
        onProgress: progress => setOcrStatus(progress.message, "working")
      });
      renderImportRows();
      const reviewCount = importRows.filter(row => row.needsReview).length;
      setOcrStatus(importRows.length ? `自動検証と再読み取りが完了しました。${importRows.length}語を抽出しました。${reviewCount ? `再読み取り後も要確認の行が${reviewCount}件あります。修正後に「確認済みにする」を押してください。` : "最も信頼できる候補を選択済みです。内容を確認して単語帳を作成してください。"}` : "単語を抽出できませんでした。表全体が写っている明るい画像で、もう一度試してください。", importRows.length ? (reviewCount ? "info" : "success") : "error");
    } catch (error) { console.error(error); const detail = error?.message ? `（${error.message}）` : ""; setOcrStatus(`画像の読み取りに失敗しました${detail}。表全体がまっすぐ写っている画像で、もう一度試してください。`, "error"); }
    finally { $("#run-ocr-button").disabled = !selectedImages.length; renderImportRows(); }
  }
  function resetNotebookForm() { $("#notebook-form").reset(); $("#editing-notebook-id").value = ""; $("#notebook-form-title").textContent = "新しい単語帳"; $("#save-notebook-button").textContent = "作成する"; $("#cancel-notebook-edit").classList.add("hidden"); }
  function resetWordForm() { $("#word-form").reset(); $("#editing-word-id").value = ""; $("#word-form-title").textContent = "単語を追加"; $("#save-word-button").textContent = "追加する"; $("#cancel-word-edit").classList.add("hidden"); }
  function startQuiz(book, words, title) {
    if (!book?.words.length || !words.length) { showToast("この単語帳には単語がありません。"); return; }
    quiz = { book, words: [...words].sort(() => Math.random() - .5), index: 0, remembered: 0, title, completed: false, settings: { ...settings } };
    $("#study-setup").classList.add("hidden"); $("#quiz-card").classList.remove("hidden"); renderQuiz();
  }
  function renderQuiz() {
    if (quiz.index >= quiz.words.length) return finishQuiz();
    const word = quiz.words[quiz.index]; const text = labels(quiz.book.category); const prompt = quiz.settings.direction === "forward" ? word.front : word.back; const answer = quiz.settings.direction === "forward" ? word.back : word.front;
    $("#quiz-card").dataset.wordId = word.id; $("#quiz-card").dataset.answer = answer;
    $("#quiz-card").innerHTML = `<div class="quiz-topbar"><div class="quiz-progress"><span>${escapeHtml(quiz.title)}</span><span>${quiz.index + 1} / ${quiz.words.length}</span></div><button id="end-quiz" class="button quiz-exit-button" type="button">テストを終了</button></div><div class="progress-line"><i style="width:${(quiz.index / quiz.words.length) * 100}%"></i></div><p class="quiz-type">${quiz.settings.direction === "forward" ? text.forward : text.reverse}</p><h3 class="question">${escapeHtml(prompt)}</h3>${quiz.settings.mode === "typing" ? `<p class="question-hint">答えを入力してください。</p><form id="answer-form" class="answer-form"><input id="quiz-answer" autocomplete="off" autocapitalize="none" required autofocus placeholder="答えを入力" /><button class="button primary" type="submit">回答する</button></form><div id="answer-result"></div>` : `<p class="question-hint">答えを表示して、自分で判定してください。</p><button id="show-answer" class="button primary large show-answer-button" type="button">答えを表示する</button>`}`;
    if (quiz.settings.mode === "typing") $("#quiz-answer").focus();
  }
  function submitTypingAnswer(event) {
    event.preventDefault(); const answer = $("#quiz-card").dataset.answer; const asksForMeaning = quiz.settings.direction === "forward"; const quizWord = wordById(quiz.book, $("#quiz-card").dataset.wordId); const storedCandidates = Array.isArray(quizWord?.answerCandidates) ? quizWord.answerCandidates.map(normalize).filter(Boolean) : []; const correctCandidates = asksForMeaning && storedCandidates.length ? storedCandidates : asksForMeaning ? answerCandidates(answer, quiz.book.category) : [normalize(answer)]; const correct = correctCandidates.includes(normalize($("#quiz-answer").value));
    if (!correct && quizWord && !quiz.book.reviewIds.includes(quizWord.id)) { quiz.book.reviewIds.unshift(quizWord.id); saveData(); }
    $("#answer-form").classList.add("hidden"); $("#answer-result").innerHTML = `<div class="result-box ${correct ? "correct" : "wrong"}">${correct ? "正解です！" : `正解は「${escapeHtml(answer)}」です。`}</div><div class="quiz-actions"><button id="next-question" class="button primary" type="button">${quiz.index + 1 === quiz.words.length ? "結果を見る" : "次の問題へ"}</button></div>`;
  }
  function showSelfcheckAnswer() { const answer = $("#quiz-card").dataset.answer; $("#show-answer").outerHTML = `<div class="answer-display"><span>答え</span><strong>${escapeHtml(answer)}</strong></div><div class="selfcheck-actions"><button class="button remember" data-selfcheck="remember" type="button">覚えた</button><button class="button forget" data-selfcheck="forget" type="button">覚えてない</button></div>`; }
  function selfcheck(result) { const id = $("#quiz-card").dataset.wordId; if (result === "forget" && !quiz.book.reviewIds.includes(id)) quiz.book.reviewIds.unshift(id); if (result === "remember") { quiz.book.reviewIds = quiz.book.reviewIds.filter(reviewId => reviewId !== id); quiz.remembered++; } quiz.index++; saveData(); renderQuiz(); }
  function nextQuestion() { quiz.index++; renderQuiz(); }
  function finishQuiz() { quiz.completed = true; $("#quiz-card").innerHTML = `<p class="quiz-type">COMPLETED</p><h3 class="question">テスト完了！</h3><p class="question-hint">おつかれさまでした。必要なら「覚えてない」または不正解だった単語を復習してください。</p><div class="quiz-actions"><button id="back-to-setup" class="button ghost" type="button">設定に戻る</button><button id="retry-quiz" class="button ghost" type="button">もう一度テスト</button><button id="go-review" class="button primary" type="button">復習を見る</button></div>`; }
  function closeQuiz(destination = "study") {
    $("#quiz-card").classList.add("hidden");
    $("#study-setup").classList.remove("hidden");
    quiz = null;
    renderStudySetup();
    goTo(destination);
  }
  function endQuiz(destination = "study") {
    if (!quiz || quiz.completed) { closeQuiz(destination); return; }
    if (!confirm("テストを終了しますか？\nここまでの復習対象は保存されます。")) return;
    saveData();
    closeQuiz(destination);
    showToast("テストを終了しました。復習対象は保存されています。");
  }

  function showSignedOut() {
    authLoadVersion++;
    currentUser = null;
    cloudReady = false;
    data = structuredClone(emptyData);
    settings.notebookId = null;
    quiz = null;
    $("#app-shell").classList.add("hidden");
    $("#app-shell").classList.remove("cloud-loading");
    $("#auth-gate").classList.remove("hidden");
    $("#account-email").textContent = "";
  }

  async function loadUserData(session, force = false) {
    const user = session?.user;
    if (!user) { showSignedOut(); return; }
    if (!force && currentUser?.id === user.id && cloudReady) return;

    const loadVersion = ++authLoadVersion;
    currentUser = user;
    cloudReady = false;
    data = structuredClone(emptyData);
    settings.notebookId = null;
    $("#account-email").textContent = user.email || "ログイン中";
    $("#auth-gate").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#app-shell").classList.add("cloud-loading");
    setCloudStatus("クラウド読込中...", "working");
    renderAll();

    try {
      let loaded = normalizeData(await window.KotobachoCloud.loadData());
      if (loadVersion !== authLoadVersion) return;

      const migrationKey = `${MIGRATION_KEY_PREFIX}${user.id}`;
      const shouldOfferMigration = !loaded.notebooks.length
        && localDataForMigration.notebooks.length
        && localStorage.getItem(migrationKey) !== "done";
      if (shouldOfferMigration && confirm("このブラウザに保存されている既存の単語帳を、このアカウントのクラウドへ移しますか？")) {
        loaded = normalizeData(localDataForMigration);
        setCloudStatus("既存データをクラウドへ移行中...", "working");
        await window.KotobachoCloud.syncData(loaded, answerCandidates);
        localStorage.setItem(migrationKey, "done");
        showToast("既存の単語帳をクラウドへ移行しました。");
      }
      if (loadVersion !== authLoadVersion) return;

      data = loaded;
      settings.notebookId = data.activeNotebookId;
      cloudReady = true;
      $("#app-shell").classList.remove("cloud-loading");
      renderAll();
      setCloudStatus("クラウド同期済み", "success");
      setAuthStatus("");
    } catch (error) {
      if (loadVersion !== authLoadVersion) return;
      console.error("Cloud load failed", error);
      cloudReady = false;
      renderAll();
      setCloudStatus(`読込エラー: ${friendlyError(error)}`, "error");
    }
  }

  async function initializeCloud() {
    if (!window.KotobachoCloud?.isConfigured()) {
      $("#supabase-config-notice").classList.remove("hidden");
      setAuthStatus("Supabaseの設定後、このページを再読み込みしてください。", "error");
      document.querySelectorAll("#login-form input,#login-form button,#signup-form input,#signup-form button").forEach(control => { control.disabled = true; });
      return;
    }

    try {
      window.KotobachoCloud.initialize();
      window.KotobachoCloud.onAuthStateChange((_event, session) => {
        // Authコールバック内で別のSupabase処理を直接待たず、次のイベントループで読み込みます。
        setTimeout(() => loadUserData(session), 0);
      });
      const session = await window.KotobachoCloud.getSession();
      await loadUserData(session);
    } catch (error) {
      console.error("Supabase initialization failed", error);
      $("#supabase-config-notice").classList.remove("hidden");
      setAuthStatus(friendlyError(error), "error");
    }
  }

  document.addEventListener("click", event => {
    const nav = event.target.closest(".nav-button"); if (nav) { if (quiz && !quiz.completed && nav.dataset.view !== "study") return endQuiz(nav.dataset.view); return goTo(nav.dataset.view); }
    const bookButton = event.target.closest("[data-select-book]"); if (bookButton) { selectBook(bookButton.dataset.selectBook); showToast("単語帳を選択しました。"); return; }
    const removeImage = event.target.closest("[data-remove-image]"); if (removeImage) { selectedImages.splice(Number(removeImage.dataset.removeImage), 1); renderSelectedImages(); setOcrStatus(selectedImages.length ? "画像を変更しました。「画像を読み取る」を押してください。" : "画像を選択して「画像を読み取る」を押してください。"); return; }
    if (event.target.id === "run-ocr-button") return runOcr();
    if (event.target.id === "add-import-row") { importRows.push({ front: "", rawMeaning: "", back: "", confidence: null, needsReview: true, status: "needs_review", reviewReason: "見出し語と意味を入力してください", source: "手入力" }); renderImportRows(); return; }
    const openOcrPreview = event.target.closest("[data-open-ocr-preview]"); if (openOcrPreview) { const row = importRows[Number(openOcrPreview.dataset.openOcrPreview)]; if (!row?.sourceImage) return; $("#ocr-preview-large-image").src = row.sourceImage; const dialog = $("#ocr-preview-dialog"); if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", ""); return; }
    if (event.target.id === "close-ocr-preview") { $("#ocr-preview-dialog").close(); return; }
    const removeImportRow = event.target.closest("[data-remove-import-row]"); if (removeImportRow) { importRows.splice(Number(removeImportRow.dataset.removeImportRow), 1); renderImportRows(); return; }
    const confirmImportRow = event.target.closest("[data-confirm-import-row]"); if (confirmImportRow) { const row = importRows[Number(confirmImportRow.dataset.confirmImportRow)]; if (row.front.trim() && row.back.trim()) { row.needsReview = false; row.status = "confirmed"; row.reviewReason = ""; } renderImportRows(); return; }
    if (event.target.id === "confirm-all-import") { importRows.forEach(row => { if (importRowStatus(row) === "needs_review" && row.front.trim() && row.back.trim()) { row.needsReview = false; row.status = "confirmed"; row.reviewReason = ""; } }); renderImportRows(); return; }
    if (event.target.id === "create-from-import") {
      const name = $("#import-notebook-name").value.trim();
      const category = $("#import-category").value;
      const words = importRows.map(row => ({ front: row.front.trim(), back: row.back.trim(), note: "", ocrRawMeaning: String(row.rawMeaning || "").trim() })).filter(word => word.front && word.back).map(word => ({ id: crypto.randomUUID(), ...word, answerCandidates: answerCandidates(word.back, category) }));
      if (!name) { setOcrStatus("単語帳の名前を入力してください。", "error"); $("#import-notebook-name").focus(); return; }
      if (!words.length) { setOcrStatus("登録できる単語がありません。見出し語と意味を入力してください。", "error"); return; }
      if (importRows.some(row => importRowStatus(row) === "needs_review" || !row.front.trim() || !row.back.trim())) { setOcrStatus("「要確認」の行が残っています。内容を修正するか、「確認済みにする」を押してください。", "error"); return; }
      const book = { id: crypto.randomUUID(), name, category, words, reviewIds: [] };
      data.notebooks.unshift(book); data.activeNotebookId = book.id; settings.notebookId = book.id; selectedImages = []; importRows = []; $("#image-input").value = ""; $("#import-notebook-name").value = ""; saveData(); setOcrStatus(`「${book.name}」を${words.length}語で作成しました。`, "success"); showToast("画像の読み取り結果から単語帳を作成しました。"); goTo("notebooks"); return;
    }
    const editBook = event.target.closest("[data-edit-book]"); if (editBook) { const book = bookById(editBook.dataset.editBook); $("#editing-notebook-id").value = book.id; $("#notebook-name").value = book.name; $("#notebook-category").value = book.category; $("#notebook-category").disabled = true; $("#notebook-form-title").textContent = "単語帳の名前を変更"; $("#save-notebook-button").textContent = "保存する"; $("#cancel-notebook-edit").classList.remove("hidden"); return; }
    const deleteBook = event.target.closest("[data-delete-book]"); if (deleteBook) { const book = bookById(deleteBook.dataset.deleteBook); if (confirm(`「${book.name}」と中の単語を削除しますか？`)) { data.notebooks = data.notebooks.filter(item => item.id !== book.id); if (data.activeNotebookId === book.id) data.activeNotebookId = data.notebooks[0]?.id || null; settings.notebookId = data.activeNotebookId; resetNotebookForm(); saveData(); showToast("単語帳を削除しました。"); } return; }
    const editWord = event.target.closest("[data-edit-word]"); if (editWord) { const word = wordById(activeBook(), editWord.dataset.editWord); $("#editing-word-id").value = word.id; $("#word-front").value = word.front; $("#word-back").value = word.back; $("#word-note").value = word.note; $("#word-form-title").textContent = "単語を編集"; $("#save-word-button").textContent = "保存する"; $("#cancel-word-edit").classList.remove("hidden"); $("#word-form").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const deleteWord = event.target.closest("[data-delete-word]"); if (deleteWord) { const book = activeBook(); const word = wordById(book, deleteWord.dataset.deleteWord); if (confirm(`「${word.front}」を削除しますか？`)) { book.words = book.words.filter(item => item.id !== word.id); book.reviewIds = book.reviewIds.filter(id => id !== word.id); saveData(); showToast("単語を削除しました。"); } return; }
    const rangeMode = event.target.closest("[data-range-mode]"); if (rangeMode) { const book = bookById(settings.notebookId); if (!book) return; studySelection.mode = rangeMode.dataset.rangeMode; if (studySelection.mode === "ranges" && !studySelection.ranges.length) studySelection.ranges.push(newStudyRange(1, Math.min(25, book.words.length))); updateStudySelectionUi(book); return; }
    const rangePreset = event.target.closest("[data-range-preset]"); if (rangePreset) { const book = bookById(settings.notebookId); if (!book || rangePreset.disabled) return; studySelection.mode = "fixed"; studySelection.preset = rangePreset.dataset.rangePreset; updateStudySelectionUi(book); return; }
    if (event.target.id === "add-study-range") { const book = bookById(settings.notebookId); if (!book) return; const priorEnds = studySelection.ranges.map(range => Number.parseInt(range.end, 10)).filter(Number.isInteger); const priorEnd = priorEnds.length ? Math.max(...priorEnds) : 0; const start = priorEnd < book.words.length ? priorEnd + 1 : ""; const end = start ? Math.min(start + 24, book.words.length) : ""; studySelection.mode = "ranges"; studySelection.ranges.push(newStudyRange(start, end)); renderStudyRangePicker(book); return; }
    const removeStudyRange = event.target.closest("[data-remove-study-range]"); if (removeStudyRange) { const book = bookById(settings.notebookId); if (!book) return; studySelection.mode = "ranges"; studySelection.ranges = studySelection.ranges.filter(range => range.id !== removeStudyRange.dataset.removeStudyRange); renderStudyRangePicker(book); return; }
    const studyNumber = event.target.closest("[data-study-number]"); if (studyNumber) { const book = bookById(settings.notebookId); if (!book) return; const number = Number(studyNumber.dataset.studyNumber); studySelection.mode = "individual"; if (studySelection.numbers.has(number)) studySelection.numbers.delete(number); else studySelection.numbers.add(number); updateStudySelectionUi(book); return; }
    const numberAction = event.target.closest("[data-number-action]"); if (numberAction) { const book = bookById(settings.notebookId); if (!book) return; studySelection.mode = "individual"; if (numberAction.dataset.numberAction === "all") studySelection.numbers = new Set(Array.from({ length: book.words.length }, (_, index) => index + 1)); if (numberAction.dataset.numberAction === "clear") studySelection.numbers.clear(); if (numberAction.dataset.numberAction === "invert") studySelection.numbers = new Set(Array.from({ length: book.words.length }, (_, index) => index + 1).filter(number => !studySelection.numbers.has(number))); updateStudySelectionUi(book); return; }
    const direction = event.target.closest("[data-direction]"); if (direction) { settings.direction = direction.dataset.direction; return renderStudySetup(); }
    const mode = event.target.closest("[data-mode]"); if (mode) { settings.mode = mode.dataset.mode; return renderStudySetup(); }
    if (event.target.id === "start-study-button") { const book = bookById(settings.notebookId); const words = book ? selectedStudyWords(book) : []; if (!words.length) { showToast("出題する単語を選んでください。"); return; } return startQuiz(book, words, book?.name || "テスト"); }
    if (event.target.id === "end-quiz") return endQuiz();
    if (event.target.id === "show-answer") return showSelfcheckAnswer();
    const selfcheckButton = event.target.closest("[data-selfcheck]"); if (selfcheckButton) return selfcheck(selfcheckButton.dataset.selfcheck);
    if (event.target.id === "next-question") return nextQuestion();
    if (event.target.id === "back-to-setup") return closeQuiz();
    if (event.target.id === "retry-quiz") return startQuiz(quiz.book, quiz.words, quiz.title);
    if (event.target.id === "go-review") return closeQuiz("review");
    if (event.target.id === "review-start") { const book = activeBook(); settings = { ...settings, notebookId: book.id, direction: "forward", mode: "selfcheck" }; goTo("study"); return startQuiz(book, book.reviewIds.map(id => wordById(book, id)).filter(Boolean), `${book.name}の復習`); }
    const removeReview = event.target.closest("[data-remove-review]"); if (removeReview) { const book = activeBook(); book.reviewIds = book.reviewIds.filter(id => id !== removeReview.dataset.removeReview); saveData(); return; }
    if (event.target.id === "cancel-notebook-edit") { $("#notebook-category").disabled = false; return resetNotebookForm(); }
    if (event.target.id === "cancel-word-edit") return resetWordForm();
    if (event.target.id === "export-button") { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `kotobacho-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); }
  });
  $("#image-input").addEventListener("change", event => { selectedImages = [...event.target.files].filter(file => file.type.startsWith("image/") || file.type === "application/pdf" || /\.pdf$/i.test(file.name)); importRows = []; renderSelectedImages(); renderImportRows(); setOcrStatus(selectedImages.length ? `${selectedImages.length}件の画像・PDFを選択しました。「画像を読み取る」を押してください。` : "画像・PDFが選択されていません。", selectedImages.length ? "info" : "error"); });
  $("#import-results").addEventListener("input", event => {
    const front = event.target.closest("[data-import-front]");
    const raw = event.target.closest("[data-import-raw]");
    const back = event.target.closest("[data-import-back]");
    const input = front || raw || back;
    if (!input) return;
    const index = Number(front ? front.dataset.importFront : raw ? raw.dataset.importRaw : back.dataset.importBack);
    const row = importRows[index];
    if (front) row.front = front.value;
    if (raw) {
      row.rawMeaning = raw.value;
      row.back = firstMeaning(raw.value);
      const backInput = $("#import-results").querySelector(`[data-import-back="${index}"]`);
      if (backInput) backInput.value = row.back;
    }
    if (back) row.back = back.value;
    const complete = row.front.trim() && row.back.trim();
    row.status = complete ? "edited" : "needs_review";
    row.needsReview = !complete;
    row.reviewReason = complete ? "" : "見出し語と意味の両方を入力してください";
    const article = $("#import-results").querySelector(`[data-import-index="${index}"]`);
    if (article) {
      article.classList.toggle("needs-review", !complete);
      article.classList.toggle("edited-row", Boolean(complete));
      const control = article.querySelector(".import-status-control");
      if (control) control.innerHTML = importStatusHtml(row, index);
    }
    updateImportControls();
  });
  $("#import-results").addEventListener("change", event => {
    if (event.target.matches("[data-import-front],[data-import-raw],[data-import-back]")) renderImportRows();
  });
  $("#ocr-preview-dialog").addEventListener("click", event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $("#study-range-list").addEventListener("input", event => {
    const startInput = event.target.closest("[data-range-start]");
    const endInput = event.target.closest("[data-range-end]");
    const input = startInput || endInput;
    const book = bookById(settings.notebookId);
    if (!input || !book) return;
    const rangeId = startInput ? startInput.dataset.rangeStart : endInput.dataset.rangeEnd;
    const range = studySelection.ranges.find(item => item.id === rangeId);
    if (!range) return;
    let value = input.value;
    if (value !== "") {
      const number = Number.parseInt(value, 10);
      value = Number.isInteger(number) ? String(Math.min(book.words.length, Math.max(1, number))) : "";
      input.value = value;
    }
    if (startInput) range.start = value;
    if (endInput) range.end = value;
    studySelection.mode = "ranges";
    updateStudySelectionUi(book);
  });
  $("#study-notebook-select").addEventListener("change", event => { settings.notebookId = event.target.value; const book = bookById(settings.notebookId); if (book) { data.activeNotebookId = book.id; saveData(); } else renderStudySetup(); });
  $("#notebook-form").addEventListener("submit", event => { event.preventDefault(); const id = $("#editing-notebook-id").value; const name = $("#notebook-name").value.trim(); const category = $("#notebook-category").value; if (!name) return; if (id) { const book = bookById(id); book.name = name; $("#notebook-category").disabled = false; showToast("単語帳の名前を変更しました。"); } else { const book = { id: crypto.randomUUID(), name, category, words: [], reviewIds: [] }; data.notebooks.unshift(book); data.activeNotebookId = book.id; settings.notebookId = book.id; showToast("単語帳を作成しました。"); } resetNotebookForm(); saveData(); });
  $("#word-form").addEventListener("submit", event => { event.preventDefault(); const book = activeBook(); if (!book) return; const id = $("#editing-word-id").value; const payload = { front: $("#word-front").value.trim(), back: $("#word-back").value.trim(), note: $("#word-note").value.trim() }; if (!payload.front || !payload.back) return; payload.answerCandidates = answerCandidates(payload.back, book.category); if (id) { Object.assign(wordById(book, id), payload); showToast("単語を更新しました。"); } else { book.words.unshift({ id: crypto.randomUUID(), ...payload }); showToast("単語を追加しました。"); } resetWordForm(); saveData(); });
  $("#quiz-card").addEventListener("submit", event => { if (event.target.id === "answer-form") submitTypingAnswer(event); });
  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    setAuthStatus("ログイン中...", "working");
    try {
      const result = await window.KotobachoCloud.signIn($("#login-email").value.trim(), $("#login-password").value);
      $("#login-password").value = "";
      await loadUserData(result.session, true);
    } catch (error) {
      setAuthStatus(friendlyError(error), "error");
    }
  });
  $("#signup-form").addEventListener("submit", async event => {
    event.preventDefault();
    setAuthStatus("アカウントを作成中...", "working");
    try {
      const result = await window.KotobachoCloud.signUp($("#signup-email").value.trim(), $("#signup-password").value);
      $("#signup-password").value = "";
      if (result.session) {
        setAuthStatus("アカウントを作成しました。", "success");
        await loadUserData(result.session, true);
      } else {
        setAuthStatus("確認メールを送信しました。メール内のリンクを開いたあとログインしてください。", "success");
      }
    } catch (error) {
      setAuthStatus(friendlyError(error), "error");
    }
  });
  $("#logout-button").addEventListener("click", async () => {
    setCloudStatus("ログアウト中...", "working");
    try {
      await window.KotobachoCloud.waitForPendingSync().catch(error => {
        console.error("Pending save failed before logout", error);
      });
      await window.KotobachoCloud.signOut();
      showSignedOut();
      setAuthStatus("ログアウトしました。", "success");
    } catch (error) {
      setCloudStatus(`ログアウトエラー: ${friendlyError(error)}`, "error");
    }
  });
  $("#reload-cloud-button").addEventListener("click", async () => {
    if (!currentUser) return;
    try {
      await window.KotobachoCloud.waitForPendingSync();
    } catch (error) {
      setCloudStatus(`保存エラー: ${friendlyError(error)}`, "error");
      return;
    }
    const session = await window.KotobachoCloud.getSession().catch(error => {
      setCloudStatus(`接続エラー: ${friendlyError(error)}`, "error");
      return null;
    });
    if (session) await loadUserData(session, true);
  });
  initializeCloud();
})();
