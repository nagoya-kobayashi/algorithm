// roster.js
// student.csv を読み込み、全ラウンド共通で使える名簿データを提供する
(() => {
  "use strict";

  const CSV_PATHS = ["./student.csv", "../student.csv"];

  const TARGET_ROUND12 = {
    year: 1,
    class: "G",
    no: 0,
    name: "小林　裕司",
    kana: "こばやし　ゆうじ",
    sex: 1,
  };

  const TARGET_ROUND3 = {
    year: 1,
    class: "X",
    no: 99,
    name: "御家　雄一",
    kana: "おいえ　ゆういち",
    sex: 1,
  };

  let rosterPromise = null;
  let rosterCache = null;

  function normalizeKana(str) {
    return String(str || "")
      .trim()
      .replaceAll(/\s+/g, "")
      .replaceAll("　", "");
  }

  const KANA_ROW_MAP = (() => {
    const map = new Map();
    const rows = [
      { label: "あ", chars: "あいうえおぁぃぅぇぉ" },
      { label: "か", chars: "かきくけこがぎぐげご" },
      { label: "さ", chars: "さしすせそざじずぜぞ" },
      { label: "た", chars: "たちつてとだぢづでどっ" },
      { label: "な", chars: "なにぬねの" },
      { label: "は", chars: "はひふへほばびぶべぼぱぴぷぺぽゔ" },
      { label: "ま", chars: "まみむめも" },
      { label: "や", chars: "やゆよゃゅょ" },
      { label: "ら", chars: "らりるれろ" },
      { label: "わ", chars: "わをんゐゑ" },
    ];
    for (const row of rows) {
      for (const ch of row.chars) {
        map.set(ch, row.label);
      }
    }
    return map;
  })();

  function toHiragana(str) {
    return String(str || "").replace(/[ァ-ン]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  function getKanaRowLabel(kana) {
    const normalized = normalizeKana(kana);
    if (!normalized) return "";
    const hira = toHiragana(normalized);
    for (const ch of hira) {
      const label = KANA_ROW_MAP.get(ch);
      if (label) return label;
    }
    return "";
  }

  function parseCsv(text) {
    const lines = String(text || "").replaceAll("\r", "").split("\n");
    const filtered = lines.filter((line) => line.trim() !== "");
    if (filtered.length < 2) return [];

    const header = filtered[0].replace(/^\ufeff/, "");
    const columns = header.split(",").map((col) => col.trim());
    const colIndex = {
      id: columns.indexOf("id"),
      year: columns.indexOf("year"),
      class: columns.indexOf("class"),
      no: columns.indexOf("no"),
      name: columns.indexOf("name"),
      kana: columns.indexOf("kana"),
      sex: columns.indexOf("sex"),
    };

    if (Object.values(colIndex).some((idx) => idx < 0)) return [];

    const rows = [];
    for (let i = 1; i < filtered.length; i++) {
      const cols = filtered[i].split(",");
      if (cols.length < columns.length) continue;

      const id = (cols[colIndex.id] || "").trim();
      if (!id) continue;

      rows.push({
        id,
        year: Number(cols[colIndex.year]),
        class: (cols[colIndex.class] || "").trim(),
        no: Number(cols[colIndex.no]),
        name: (cols[colIndex.name] || "").trim(),
        kana: (cols[colIndex.kana] || "").trim(),
        sex: Number(cols[colIndex.sex]),
      });
    }

    return rows;
  }

  function cloneEntry(entry) {
    return { ...entry };
  }

  function compareKana(a, b) {
    const ak = normalizeKana(a.kana);
    const bk = normalizeKana(b.kana);
    return ak.localeCompare(bk, "ja");
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function createTargetRecord(base, id) {
    return {
      id,
      year: base.year,
      class: base.class,
      no: base.no,
      name: base.name,
      kana: base.kana,
      sex: base.sex,
      isTarget: true,
    };
  }

  async function loadRoster() {
    if (rosterPromise) return rosterPromise;

    rosterPromise = (async () => {
      for (const path of CSV_PATHS) {
        try {
          const url = new URL(path, window.location.href);
          const res = await fetch(url.toString(), { cache: "no-store" });
          if (!res.ok) throw new Error("http");
          const text = await res.text();
          const parsed = parseCsv(text);
          if (parsed.length) {
            rosterCache = parsed;
            return parsed;
          }
        } catch {
          // 次のパスを試す
        }
      }
      rosterCache = [];
      return [];
    })();

    return rosterPromise;
  }

  function getUserById(userId) {
    if (!rosterCache || !userId) return null;
    const key = String(userId).trim();
    return rosterCache.find((row) => row.id === key) || null;
  }

  function buildRoundRoster(roundNo, user) {
    if (!rosterCache || !rosterCache.length || !user) {
      return { roster: [], meta: {} };
    }

    const round = Number(roundNo);
    const year = Number(user.year);
    const className = String(user.class);

    let roster = [];
    let meta = {};

    if (round === 1) {
      roster = rosterCache
        .filter((row) => row.year === year && String(row.class) === className)
        .map(cloneEntry);
      roster.push(createTargetRecord(TARGET_ROUND12, "target-round1"));
      shuffle(roster);
    } else if (round === 2) {
      roster = rosterCache
        .filter((row) => row.year === year)
        .map(cloneEntry);
      roster.push(createTargetRecord(TARGET_ROUND12, "target-round2"));
      roster.sort(compareKana);
      let lastLabel = "";
      roster.forEach((row) => {
        const label = getKanaRowLabel(row.kana);
        if (label && label !== lastLabel) {
          row.index = label;
          lastLabel = label;
        } else {
          row.index = "";
        }
      });
      meta.indexColumn = true;
      meta.kanaSorted = true;
    } else if (round === 3) {
      roster = rosterCache
        .filter((row) => row.year === year)
        .map(cloneEntry);
      roster.push(createTargetRecord(TARGET_ROUND3, "target-round3"));
      roster.sort(compareKana);
      meta.kanaSorted = true;
    } else if (round === 4) {
      roster = rosterCache.map(cloneEntry);
      roster.sort(compareKana);
      meta.kanaSorted = true;

      const targetId = String(user.id);
      let found = false;
      for (const row of roster) {
        if (String(row.id) === targetId) {
          row.isTarget = true;
          found = true;
          break;
        }
      }
      if (!found) {
        roster.push({ ...cloneEntry(user), isTarget: true });
      }
    } else {
      roster = rosterCache.map(cloneEntry);
    }

    return { roster, meta };
  }

  window.RosterStore = {
    load: loadRoster,
    getUserById,
    buildRoundRoster,
  };
})();
