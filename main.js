// main.js
(() => {
  "use strict";

  const LOG_ENDPOINT = "./log_result.pl";
  const RANK_ENDPOINT = "./get_ranking.pl";
  const ROUND_MAX = 4;
  const MATCH_STEP_MS = 300;
  const INTRO_HOLD_MS = 2400;
  const INTRO_FADE_MS = 700;

  const ROUND_CONFIG = {
    1: {
      roundNo: 1,
      roundLabel: "ラウンド1",
      headerLabel: "ラウンド1：単純前方探索「こばやし　ゆうじ　を探せ！」",
      algorithm: "単純前方探索",
      task: "こばやし　ゆうじ　を探せ！",
      paneTitle: "名簿（ラウンド1：ランダム順）",
    },
    2: {
      roundNo: 2,
      roundLabel: "ラウンド2",
      headerLabel: "ラウンド2：改良型前方探索「こばやし　ゆうじ　を探せ！」",
      algorithm: "改良型前方探索",
      task: "こばやし　ゆうじ　を探せ！",
      paneTitle: "名簿（ラウンド2：かな順＋インデクス）",
    },
    3: {
      roundNo: 3,
      roundLabel: "ラウンド3",
      headerLabel: "ラウンド3：二分探索「おいえ　ゆういち　を探せ！」",
      algorithm: "二分探索",
      task: "おいえ　ゆういち　を探せ！",
      paneTitle: "名簿（ラウンド3：かな順）",
    },
    4: {
      roundNo: 4,
      roundLabel: "ラウンドFINAL",
      headerLabel: "ラウンドFINAL：二分探索「ジブン　を探せ！」",
      algorithm: "二分探索",
      task: "ジブン　を探せ！",
      paneTitle: "名簿（ラウンドFINAL：かな順）",
    },
  };

  const UI_STATE = {
    ready: "state-ready",
    playing: "state-playing",
    cleared: "state-cleared",
  };

  // ====== DOM ======
  const titleScreen = document.getElementById("titleScreen");
  const startButton = document.getElementById("startButton");
  const titleUserEl = document.getElementById("titleUser");
  const titleNoticeEl = document.getElementById("titleNotice");

  const roundIntro = document.getElementById("roundIntro");
  const introRoundText = document.getElementById("introRoundText");
  const introAlgorithmText = document.getElementById("introAlgorithmText");
  const introTaskText = document.getElementById("introTaskText");
  const introImage = document.getElementById("introImage");

  const gameScreen = document.getElementById("gameScreen");
  const resultScreen = document.getElementById("resultScreen");
  const resultUserEl = document.getElementById("resultUser");

  const rosterTable = document.getElementById("rosterTable");
  const rosterBody = document.getElementById("rosterBody");
  const searchCountEl = document.getElementById("searchCount");
  const timeTextEl = document.getElementById("timeText");
  const rankingCardEl = document.getElementById("rankingCard");
  const rankingListEl = document.getElementById("rankingList");
  const resultLinkEl = document.getElementById("toResultLink");

  const roundBadgeEl = document.getElementById("roundBadge");
  const paneTitleEl = document.getElementById("paneTitle");
  const userIdBadgeEl = document.getElementById("userIdBadge");
  const userIdNoticeEl = document.getElementById("userIdNotice");
  const roundItems = Array.from(document.querySelectorAll(".round-item[data-round]"));

  const resultRankingEls = new Map([
    [1, document.getElementById("resultRanking1")],
    [2, document.getElementById("resultRanking2")],
    [3, document.getElementById("resultRanking3")],
    [4, document.getElementById("resultRanking4")],
  ]);

  // ====== 状態 ======
  let rosterAll = [];
  let roster = [];
  let rosterMeta = {};
  let revealed = [];
  let rosterReady = false;
  let currentUserId = "";
  let currentUser = null;
  let currentRound = 1;

  let searchCount = 0;
  let startedAt = null;     // performance.now()
  let clearedAt = null;     // performance.now()
  let cleared = false;

  let timerRAF = null;
  let rankingTimer = null;
  let rankingPollingKey = "";
  let nextRoundsUnlocked = false;
  let isMatching = false;
  let introActive = false;
  let resultTimer = null;

  // ====== Utils ======
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatIntroTaskHtml(taskText) {
    const text = String(taskText || "");
    const marker = "を探せ";
    const idx = text.indexOf(marker);
    if (idx <= 0) return escapeHtml(text);
    const prefix = text.slice(0, idx);
    const suffix = text.slice(idx);
    const trimmed = prefix.replace(/[ 　]+$/g, "");
    if (!trimmed) return escapeHtml(text);
    const spacer = prefix.slice(trimmed.length);
    return `<span class="intro-task-name">${escapeHtml(trimmed)}</span>${escapeHtml(spacer)}${escapeHtml(suffix)}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function msToTime(ms) {
    const t = Math.max(0, Math.floor(ms));
    const m = Math.floor(t / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const d = t % 1000;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    const dd = String(d).padStart(3, "0");
    return `${mm}:${ss}.${dd}`;
  }

  function setTitleNotice(msg) {
    if (titleNoticeEl) titleNoticeEl.textContent = msg || "";
  }

  function setUserNotice(msg) {
    if (userIdNoticeEl) userIdNoticeEl.textContent = msg || "";
  }

  function parseUserIdFromHash(hashStr) {
    const hash = String(hashStr || "");
    const match = hash.match(/(?:^|#|&)id=([^&]+)/i);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  }

  function updateUserIdDisplay() {
    currentUserId = parseUserIdFromHash(window.location.hash);

    const label = currentUserId ? `ユーザID: ${currentUserId}` : "ユーザID: （未設定）";
    if (userIdBadgeEl) userIdBadgeEl.textContent = label;
    if (titleUserEl) titleUserEl.textContent = label;
    if (resultUserEl) resultUserEl.textContent = label;
  }

  function syncCurrentUser() {
    if (!rosterReady || !currentUserId) {
      currentUser = null;
      return;
    }
    const store = window.RosterStore;
    if (!store || !store.getUserById) {
      currentUser = null;
      return;
    }
    currentUser = store.getUserById(currentUserId);
  }

  function refreshUserNotice() {
    if (!currentUserId) {
      setTitleNotice("URLの末尾に「#id=ユーザID」を指定してください。");
      setUserNotice("URLの末尾に「#id=ユーザID」を指定してください。");
      return;
    }
    if (!rosterReady) {
      setTitleNotice("名簿データを読み込み中です。");
      setUserNotice("名簿データを読み込み中です。");
      return;
    }
    if (!currentUser) {
      setTitleNotice("名簿に存在しないユーザIDです。");
      setUserNotice("名簿に存在しないユーザIDです。");
      return;
    }
    setTitleNotice("");
    setUserNotice("");
  }

  function ensureUserIdReady() {
    refreshUserNotice();
    return !!(currentUserId && rosterReady && currentUser);
  }

  function setUiState(stateKey) {
    const classList = document.body.classList;
    classList.remove(UI_STATE.ready, UI_STATE.playing, UI_STATE.cleared);
    const nextClass = UI_STATE[stateKey] || stateKey;
    if (nextClass) classList.add(nextClass);
  }

  function setCardVisible(el, isVisible) {
    if (!el) return;
    el.classList.toggle("is-hidden", !isVisible);
    if (isVisible) {
      el.removeAttribute("aria-hidden");
    } else {
      el.setAttribute("aria-hidden", "true");
    }
  }

  function setScreenVisible(el, isVisible) {
    if (!el) return;
    el.classList.toggle("is-hidden", !isVisible);
    el.setAttribute("aria-hidden", isVisible ? "false" : "true");
  }

  function showTitleScreen({ resetGame = false } = {}) {
    if (resetGame) {
      setRosterData([]);
    }
    setScreenVisible(titleScreen, true);
    setScreenVisible(gameScreen, false);
    setScreenVisible(resultScreen, false);
    stopResultPolling();
  }

  function showGameScreen() {
    setScreenVisible(titleScreen, false);
    setScreenVisible(gameScreen, true);
    setScreenVisible(resultScreen, false);
    stopResultPolling();
  }

  function showResultScreen() {
    setScreenVisible(titleScreen, false);
    setScreenVisible(gameScreen, false);
    setScreenVisible(resultScreen, true);
    stopRankingPolling();
    if (currentUserId) {
      startResultPolling(currentUserId);
    }
  }

  function updateRoundLabels(config) {
    if (roundBadgeEl) roundBadgeEl.textContent = config.headerLabel;
    if (paneTitleEl) paneTitleEl.textContent = config.paneTitle;
    document.title = `探索ゲーム（${config.headerLabel}）`;
  }

  function updateRoundNavState() {
    for (const item of roundItems) {
      const roundNo = Number(item.dataset.round);
      if (!Number.isFinite(roundNo)) continue;

      const isCurrent = roundNo === currentRound;
      const isPrev = roundNo < currentRound;
      const isNext = roundNo === (currentRound + 1);
      const isFuture = roundNo > (currentRound + 1);

      const isEnabled = isNext && nextRoundsUnlocked;
      const isDisabled = !isCurrent && !isEnabled;

      item.classList.toggle("active", isCurrent);
      item.classList.toggle("is-prev", isPrev);
      item.classList.toggle("is-next", isNext);
      item.classList.toggle("is-future", isFuture);
      item.classList.toggle("is-enabled", isEnabled);
      item.classList.toggle("is-disabled", isDisabled);
      item.setAttribute("aria-disabled", (isCurrent || isEnabled) ? "false" : "true");
      item.tabIndex = (isCurrent || isEnabled) ? 0 : -1;
    }
  }

  function setNextRoundEnabled(isEnabled) {
    if (currentRound >= ROUND_MAX) {
      nextRoundsUnlocked = false;
    } else {
      nextRoundsUnlocked = isEnabled;
    }
    updateRoundNavState();
  }

  function setResultPanelsVisible(isVisible) {
    setCardVisible(rankingCardEl, isVisible);
  }

  function updateResultLinkVisibility() {
    if (!resultLinkEl) return;
    const shouldShow = currentRound === 4 && cleared;
    resultLinkEl.classList.toggle("is-hidden", !shouldShow);
    resultLinkEl.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  }

  function resetGameState({ showRanking = false } = {}) {
    cleared = false;
    searchCount = 0;
    startedAt = null;
    clearedAt = null;
    isMatching = false;
    introActive = false;
    setNextRoundEnabled(false);

    if (timerRAF) {
      cancelAnimationFrame(timerRAF);
      timerRAF = null;
    }

    stopRankingPolling();
    if (rankingListEl) rankingListEl.innerHTML = "";

    if (searchCountEl) searchCountEl.textContent = String(searchCount);
    if (timeTextEl) timeTextEl.textContent = "--:--.---";

    setUiState("ready");
    setResultPanelsVisible(showRanking);
    updateResultLinkVisibility();
  }

  function setRosterData(nextRoster, meta = {}, options = {}) {
    roster = Array.isArray(nextRoster) ? nextRoster : [];
    rosterMeta = meta || {};
    revealed = new Array(roster.length).fill(false);
    resetGameState(options);
    buildTableSkeleton();
  }

  function applyRosterForCurrentRound() {
    if (!rosterReady) return;

    if (!currentUserId) {
      currentUser = null;
      setUserNotice("URLの末尾に「#id=ユーザID」を指定してください。");
      setRosterData([]);
      return;
    }

    const store = window.RosterStore;
    if (!store || !store.getUserById || !store.buildRoundRoster) {
      currentUser = null;
      setUserNotice("名簿データの読み込みに失敗しました。");
      setRosterData([]);
      return;
    }

    currentUser = store.getUserById(currentUserId);
    if (!currentUser) {
      setUserNotice("名簿に存在しないユーザIDです。");
      setRosterData([]);
      return;
    }

    setUserNotice("");
    const result = store.buildRoundRoster(currentRound, currentUser);
    setRosterData(result.roster, result.meta, { showRanking: true });
    startRankingPolling(currentUserId);
  }

  // ====== UI生成 ======
  function buildTableSkeleton() {
    if (!rosterBody) return;
    rosterBody.innerHTML = "";
    if (rosterTable) {
      rosterTable.classList.toggle("has-index", !!rosterMeta.indexColumn);
      rosterTable.classList.toggle("has-kana-sort", !!rosterMeta.kanaSorted);
    }

    for (let i = 0; i < roster.length; i++) {
      const tr = document.createElement("tr");
      tr.dataset.idx = String(i);
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `行 ${i + 1}`);

      const indexValue = rosterMeta.indexColumn ? (roster[i].index ?? "") : "";

      tr.innerHTML = `
        <td class="col-idx">${i + 1}</td>
        <td class="col-year"></td>
        <td class="col-class"></td>
        <td class="col-no"></td>
        <td class="col-name"></td>
        <td class="col-index">${escapeHtml(indexValue)}</td>
        <td class="col-kana">
          <div class="kana-wrap">
            <span class="kana-cpu" aria-hidden="true"></span>
            <span class="kana-status" aria-hidden="true"></span>
            <span class="kana-text"></span>
          </div>
        </td>
      `.trim();

      tr.addEventListener("click", onRowActivate);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowActivate(e);
        }
      });

      rosterBody.appendChild(tr);
    }
  }

  function setRowMeta(tr, row) {
    const yearEl = tr.querySelector(".col-year");
    const classEl = tr.querySelector(".col-class");
    const noEl = tr.querySelector(".col-no");
    const nameEl = tr.querySelector(".col-name");
    if (yearEl) yearEl.textContent = String(row.year);
    if (classEl) classEl.textContent = String(row.class);
    if (noEl) noEl.textContent = String(row.no);
    if (nameEl) nameEl.textContent = row.name;
  }

  function setKanaText(tr, text) {
    const kanaTextEl = tr.querySelector(".kana-text");
    if (!kanaTextEl) return;
    kanaTextEl.textContent = text;
  }

  function setMatchStatus(tr, status) {
    const statusEl = tr.querySelector(".kana-status");
    if (!statusEl) return;

    const normalized = status === "matched" || status === "unmatched" ? status : "";
    statusEl.textContent = normalized;
    statusEl.classList.toggle("is-matched", normalized === "matched");
    statusEl.classList.toggle("is-unmatched", normalized === "unmatched");
    tr.classList.toggle("has-status", normalized !== "");
  }

  function revealRow(idx) {
    const tr = rosterBody.querySelector(`tr[data-idx="${idx}"]`);
    if (!tr) return;

    const r = roster[idx];
    tr.classList.remove("is-matching");
    tr.classList.add("revealed");
    setRowMeta(tr, r);
    setKanaText(tr, r.kana);
  }

  function revealAllAfterClear() {
    for (let i = 0; i < roster.length; i++) {
      revealRow(i);
      const tr = rosterBody.querySelector(`tr[data-idx="${i}"]`);
      if (!tr) continue;

      tr.classList.add("disabled");
      tr.setAttribute("aria-disabled", "true");
      tr.tabIndex = -1;

      // 未クリック行は青字
      if (!revealed[i]) {
        tr.classList.add("unvisited");
      } else {
        tr.classList.remove("unvisited");
      }
    }
  }

  function updateSearchCount() {
    if (searchCountEl) searchCountEl.textContent = String(searchCount);
  }

  // ====== タイマー ======
  function startTimerIfNeeded() {
    if (startedAt !== null) return;
    startedAt = performance.now();
    setUiState("playing");
    tickTimer();
  }

  function tickTimer() {
    if (startedAt === null) return;
    const now = (clearedAt !== null) ? clearedAt : performance.now();
    if (timeTextEl) timeTextEl.textContent = msToTime(now - startedAt);
    if (clearedAt === null) {
      timerRAF = requestAnimationFrame(tickTimer);
    }
  }

  function stopTimer() {
    if (startedAt === null) return 0;
    clearedAt = performance.now();
    if (timerRAF) cancelAnimationFrame(timerRAF);
    tickTimer(); // 最終表示
    return Math.max(0, Math.round(clearedAt - startedAt));
  }

  // ====== クリック処理 ======
  async function onRowActivate(e) {
    if (cleared) return;
    if (isMatching || introActive) return;
    if (!ensureUserIdReady()) return;

    const tr = e.currentTarget;
    const idx = Number(tr.dataset.idx);
    const row = roster[idx];
    if (!row) return;

    if (revealed[idx]) return;

    isMatching = true;
    setMatchStatus(tr, "");
    tr.classList.add("is-matching");

    // カウント・タイマー
    searchCount += 1;
    updateSearchCount();
    startTimerIfNeeded();

    try {
      await runMatchingAnimation(tr, row.kana);
      revealRow(idx);
      setMatchStatus(tr, row.isTarget ? "matched" : "unmatched");
      revealed[idx] = true;
    } finally {
      tr.classList.remove("is-matching");
      isMatching = false;
    }

    if (row.isTarget) {
      onClear(idx);
    }
  }

  // ====== クリア処理 ======
  async function onClear(hitIdx) {
    if (cleared) return;
    cleared = true;

    const clearTimeMs = stopTimer();
    setUiState("cleared");

    // クリア後の表示
    revealAllAfterClear();
    setResultPanelsVisible(true);
    updateResultLinkVisibility();

    launchCelebration();

    // ログ送信
    const userId = currentUserId;
    await sendResult({ userId, roundNo: currentRound, searchCount, clearTimeMs });

    // ランキング開始
    startRankingPolling(userId);
  }

  // ====== 通信：ログ送信 ======
  async function sendResult({ userId, roundNo, searchCount, clearTimeMs }) {
    const payload = new URLSearchParams();
    payload.set("user_id", userId);
    payload.set("round_no", String(roundNo));
    payload.set("search_count", String(searchCount));
    payload.set("clear_time_ms", String(clearTimeMs));

    try {
      const res = await fetch(LOG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: payload.toString(),
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      return data && data.ok === 1;
    } catch {
      return false;
    }
  }

  // ====== 通信：ランキング ======
  function startRankingPolling(userId) {
    if (!userId || !rankingListEl) return;
    const nextKey = `${userId}:${currentRound}`;
    if (rankingPollingKey === nextKey && rankingTimer) return;

    stopRankingPolling();
    rankingPollingKey = nextKey;
    rankingListEl.innerHTML = "";

    // すぐ1回
    fetchAndRenderRanking(userId);

    // 2秒おき
    rankingTimer = setInterval(() => {
      fetchAndRenderRanking(userId);
    }, 2000);
  }

  async function fetchRankingData(userId, roundNo) {
    const url = new URL(RANK_ENDPOINT, window.location.href);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("round_no", String(roundNo));

    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error("http");

    const data = await res.json();
    if (!data || data.ok !== 1 || !Array.isArray(data.ranking)) {
      throw new Error("badjson");
    }

    return data;
  }

  async function fetchAndRenderRanking(userId) {
    try {
      const data = await fetchRankingData(userId, currentRound);
      renderRanking(rankingListEl, data.ranking, userId);
      const count = Number.isFinite(data.count) ? data.count : data.ranking.length;
      if (count >= 10 && !nextRoundsUnlocked && currentRound < ROUND_MAX) {
        setNextRoundEnabled(true);
      }
    } catch {
      // 失敗しても継続
    }
  }

  function stopRankingPolling() {
    if (rankingTimer) {
      clearInterval(rankingTimer);
      rankingTimer = null;
    }
    rankingPollingKey = "";
  }

  function splitDisplayName(displayName) {
    const text = String(displayName || "").trim();
    if (!text) return { no: "", name: "" };
    const spaceIndex = text.indexOf(" ");
    if (spaceIndex === -1) return { no: "", name: text };
    return {
      no: text.slice(0, spaceIndex).trim(),
      name: text.slice(spaceIndex + 1).trim(),
    };
  }

  function renderRanking(listEl, items, userId) {
    if (!listEl) return;
    listEl.innerHTML = "";

    const myId = String(userId || "").trim();

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const rank = (it.rank ?? (i + 1));
      const rawDisplayName = it.display_name ?? "";
      const parts = splitDisplayName(rawDisplayName);
      const no = parts.no || "-";
      const name = parts.name || rawDisplayName || it.user_id || "（未設定）";
      const sc = it.search_count ?? "-";
      const tm = it.clear_time_ms ?? null;

      const row = document.createElement("div");
      row.className = "ranking-row";
      const isMe = (it.user_id && String(it.user_id).trim() === myId);
      if (isMe) row.classList.add("me");
      row.setAttribute("role", "row");

      row.innerHTML = `
        <div class="ranking-cell-rank" role="cell">${escapeHtml(rank)}</div>
        <div class="ranking-cell-no" role="cell">${escapeHtml(no)}</div>
        <div class="ranking-cell-name" role="cell">${escapeHtml(name)}</div>
        <div class="ranking-cell-time" role="cell">${tm === null ? "-" : escapeHtml(msToTime(tm))}</div>
        <div class="ranking-cell-count" role="cell">${escapeHtml(sc)}</div>
      `.trim();

      listEl.appendChild(row);
    }
  }

  async function runMatchingAnimation(tr, text) {
    const kanaTextEl = tr.querySelector(".kana-text");
    if (!kanaTextEl) return;

    const chars = Array.from(String(text || ""));
    if (chars.length === 0) {
      return;
    }

    kanaTextEl.innerHTML = "";
    const spans = chars.map((ch) => {
      const span = document.createElement("span");
      span.className = "kana-char";
      span.textContent = ch;
      kanaTextEl.appendChild(span);
      return span;
    });

    for (let i = 0; i < spans.length; i++) {
      for (let j = 0; j < spans.length; j++) {
        spans[j].classList.remove("is-past", "is-current");
        if (j < i) {
          spans[j].classList.add("is-past");
        } else if (j === i) {
          spans[j].classList.add("is-current");
        }
      }
      await sleep(MATCH_STEP_MS);
    }

    for (const span of spans) {
      span.classList.remove("is-current");
      span.classList.add("is-past");
    }
  }

  function launchCelebration() {
    const layer = document.createElement("div");
    layer.className = "celebration-layer";

    const message = document.createElement("div");
    message.className = "celebration-message";
    message.innerHTML = '<span class="celebration-text">クリアおめでとう！</span>';

    const confettiLayer = document.createElement("div");
    confettiLayer.className = "confetti-layer";

    const colors = [
      "#ffd166",
      "#ff7b9c",
      "#6ee7f2",
      "#8cffb5",
      "#c7b6ff",
      "#ffb347",
      "#fff1a8",
      "#7aa5ff",
      "#ff9ef0",
      "#9fffe0",
    ];
    const count = 320;

    for (let i = 0; i < count; i++) {
      const confetti = document.createElement("div");
      confetti.className = "confetti";
      confetti.style.setProperty("--x", `${Math.random() * 100}vw`);
      confetti.style.setProperty("--drift", `${(Math.random() * 60 - 30).toFixed(2)}vw`);
      confetti.style.setProperty("--duration", `${(3 + Math.random() * 3).toFixed(2)}s`);
      confetti.style.setProperty("--delay", `${(Math.random() * 0.6).toFixed(2)}s`);

      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      const size = 4 + Math.random() * 12;
      piece.style.setProperty("--size", `${size.toFixed(1)}px`);
      piece.style.setProperty("--confetti-color", colors[Math.floor(Math.random() * colors.length)]);
      piece.style.setProperty("--spin", `${(0.6 + Math.random() * 1.8).toFixed(2)}s`);
      if (Math.random() > 0.7) {
        piece.style.borderRadius = "999px";
      }

      confetti.appendChild(piece);
      confettiLayer.appendChild(confetti);
    }

    layer.appendChild(confettiLayer);
    layer.appendChild(message);
    document.body.appendChild(layer);

    window.setTimeout(() => {
      layer.remove();
    }, 5200);
  }

  // ====== ラウンド導入演出 ======
  async function playRoundIntro(config) {
    if (!roundIntro) return;

    if (introRoundText) introRoundText.textContent = config.roundLabel;
    if (introAlgorithmText) introAlgorithmText.textContent = config.algorithm;
    if (introTaskText) introTaskText.innerHTML = formatIntroTaskHtml(config.task);
    if (introImage) introImage.src = "memory.png";

    roundIntro.classList.remove("is-active", "is-hiding");
    roundIntro.setAttribute("aria-hidden", "false");
    void roundIntro.offsetWidth;
    roundIntro.classList.add("is-active");

    await sleep(INTRO_HOLD_MS);
    roundIntro.classList.add("is-hiding");
    await sleep(INTRO_FADE_MS);

    roundIntro.classList.remove("is-active", "is-hiding");
    roundIntro.setAttribute("aria-hidden", "true");
  }

  // ====== 結果画面ランキング ======
  function startResultPolling(userId) {
    stopResultPolling();
    fetchAndRenderAllResults(userId);
    resultTimer = setInterval(() => {
      fetchAndRenderAllResults(userId);
    }, 1000);
  }

  function stopResultPolling() {
    if (resultTimer) {
      clearInterval(resultTimer);
      resultTimer = null;
    }
  }

  async function fetchAndRenderAllResults(userId) {
    for (let roundNo = 1; roundNo <= ROUND_MAX; roundNo++) {
      const listEl = resultRankingEls.get(roundNo);
      if (!listEl) continue;
      try {
        const data = await fetchRankingData(userId, roundNo);
        renderRanking(listEl, data.ranking, userId);
      } catch {
        // 失敗しても継続
      }
    }
  }

  // ====== 進行・開始 ======
  async function fetchRoundCleared(userId, roundNo) {
    const data = await fetchRankingData(userId, roundNo);
    const targetId = String(userId || "").trim();
    return data.ranking.some((item) => {
      const itemId = String(item.user_id || "").trim();
      const tm = Number(item.clear_time_ms);
      return itemId === targetId && Number.isFinite(tm) && tm >= 0;
    });
  }

  async function determineStartRound(userId) {
    const rounds = [1, 2, 3, 4];
    const clearedFlags = await Promise.all(
      rounds.map((roundNo) => fetchRoundCleared(userId, roundNo).catch(() => false))
    );

    for (let i = 0; i < rounds.length; i++) {
      if (!clearedFlags[i]) return rounds[i];
    }
    return null;
  }

  function setStartButtonBusy(isBusy) {
    if (!startButton) return;
    startButton.disabled = isBusy;
    startButton.textContent = isBusy ? "確認中..." : "はじめる";
  }

  async function handleStartClick() {
    if (!ensureUserIdReady()) return;

    setStartButtonBusy(true);
    const nextRound = await determineStartRound(currentUserId);
    setStartButtonBusy(false);

    if (!nextRound) {
      currentRound = 4;
      updateRoundLabels(ROUND_CONFIG[4]);
      applyRosterForCurrentRound();
      showResultScreen();
      return;
    }

    await startRound(nextRound, { showIntro: true });
  }

  async function startRound(roundNo, { showIntro = true } = {}) {
    const config = ROUND_CONFIG[roundNo];
    if (!config) return;

    if (!ensureUserIdReady()) return;

    currentRound = roundNo;
    updateRoundLabels(config);
    setNextRoundEnabled(false);
    updateRoundNavState();

    applyRosterForCurrentRound();
    showGameScreen();

    if (showIntro) {
      introActive = true;
      await playRoundIntro(config);
      introActive = false;
    }
  }

  // ====== ナビゲーション ======
  function initRoundNav() {
    for (const item of roundItems) {
      const activate = () => {
        if (!item.classList.contains("is-enabled")) return;
        const roundNo = Number(item.dataset.round);
        if (!Number.isFinite(roundNo)) return;
        startRound(roundNo, { showIntro: true });
      };

      item.addEventListener("click", activate);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    }
  }

  function initUserId() {
    updateUserIdDisplay();
    syncCurrentUser();
    refreshUserNotice();

    window.addEventListener("hashchange", () => {
      updateUserIdDisplay();
      syncCurrentUser();
      refreshUserNotice();
      showTitleScreen({ resetGame: true });
      if (currentUserId) {
        setTitleNotice("ユーザIDが変更されました。もう一度「はじめる」を押してください。");
      }
    });
  }

  function disableBrowserBack() {
    history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", () => {
      history.pushState(null, "", window.location.href);
    });
  }

  async function loadRosterData() {
    const store = window.RosterStore;
    if (!store || !store.load) return [];
    const data = await store.load();
    return Array.isArray(data) ? data : [];
  }

  async function init() {
    disableBrowserBack();
    initRoundNav();
    initUserId();

    setTitleNotice("名簿データを読み込み中です。");
    rosterAll = await loadRosterData();
    rosterReady = true;
    syncCurrentUser();
    refreshUserNotice();

    if (!rosterAll.length) {
      alert("名簿データの読み込みに失敗しました。（student.csv）");
      setTitleNotice("名簿データの読み込みに失敗しました。");
      return;
    }

    if (startButton) {
      startButton.addEventListener("click", handleStartClick);
    }

    if (resultLinkEl) {
      resultLinkEl.addEventListener("click", (e) => {
        e.preventDefault();
        if (!currentUserId) return;
        showResultScreen();
      });
    }

    updateRoundNavState();
    showTitleScreen();
  }

  init();
})();
