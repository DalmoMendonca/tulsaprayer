const dataUrl = "./data/tulsa-nsa.geojson";
const prayerApiUrl = "/api/prayers";

let areas = [];
let prayers = {};
let selectedIds = new Set();
let sortKey = null;
let sortDesc = true;

const stats = [
  { key: "score", label: "Conditions", icon: "activity", format: (v) => (v ? v.toFixed(1) : "N/A"), best: "max", tip: "Overall conditions score" },
  { key: "rank", label: "Rank", icon: "trophy", format: (v) => (v ? "#" + v : "\u2014"), best: "min", tip: "Overall rank (lower = more need)" },
  { key: "population", label: "Population", icon: "users", format: formatNumber, best: "max", tip: "Total population" },
  { key: "areaSqMiles", label: "Area", icon: "map", format: (v) => v.toFixed(2) + " mi\u00B2", best: "max", tip: "Square miles" },
  { key: "density", label: "Density", icon: "grid-3x3", format: (v) => formatNumber(Math.round(v)), best: "max", tip: "People per square mile" },
  { key: "medianIncome", label: "Median Income", icon: "dollar-sign", format: (v) => "$" + formatNumber(v), best: "max", tip: "Median household income" },
  { key: "prayers", label: "Prayers", icon: "heart", format: (v) => String(v), best: "max", tip: "Prayers registered" },
];

const toggleList = document.querySelector("#toggleList");
const tableHead = document.querySelector("#tableHead");
const tableBody = document.querySelector("#tableBody");
const searchInput = document.querySelector("#searchAreas");
const selectAllBtn = document.querySelector("#selectAll");
const selectNoneBtn = document.querySelector("#selectNone");
const areaCount = document.querySelector("#areaCount");

init();

async function init() {
  const [geojson, prayerData] = await Promise.all([
    fetch(dataUrl).then((r) => r.json()),
    fetch(prayerApiUrl)
      .then((r) => r.json())
      .catch(() => ({})),
  ]);

  areas = normalizeAreas(geojson);
  prayers = prayerData;

  areas.forEach((a) => selectedIds.add(a.id));

  buildToggles();
  buildTable();

  selectAllBtn.addEventListener("click", () => {
    areas.forEach((a) => selectedIds.add(a.id));
    syncToggles();
    buildTable();
  });

  selectNoneBtn.addEventListener("click", () => {
    selectedIds.clear();
    syncToggles();
    buildTable();
  });

  searchInput.addEventListener("input", filterToggles);
  refreshIcons();
}

function normalizeAreas(geojson) {
  return geojson.features
    .map((f) => {
      const p = f.properties;
      const name = p.Neighorhood || p.Neighborhood || "Area " + p.Map_ID;
      return {
        id: "nsa-" + p.Map_ID,
        mapId: p.Map_ID,
        name: name,
        score: Number(p.Overall_Score ?? 0),
        rank: Number(p.Overall_Rank ?? 0),
        population: Number(p.Population ?? 0),
        areaSqMiles: Number(p.Area_Sq_Miles ?? 0),
        density: Number(p.Pop_Density ?? 0),
        medianIncome: Number(p.Median_Household_Income ?? 0),
      };
    })
    .sort((a, b) => a.mapId - b.mapId);
}

function statValue(area, key) {
  if (key === "prayers") return (prayers[area.id] || []).length;
  return area[key] ?? 0;
}

function buildToggles() {
  toggleList.innerHTML = areas
    .map((area) => {
      var cls = selectedIds.has(area.id) ? "gm-chip is-active" : "gm-chip";
      return '<button class="' + cls + '" data-id="' + area.id + '">' + escapeHtml(area.name) + "</button>";
    })
    .join("");

  toggleList.addEventListener("click", function (e) {
    var btn = e.target.closest(".gm-chip");
    if (!btn) return;
    var id = btn.dataset.id;
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      btn.classList.remove("is-active");
    } else {
      selectedIds.add(id);
      btn.classList.add("is-active");
    }
    updateCount();
    buildTable();
  });

  updateCount();
}

function syncToggles() {
  toggleList.querySelectorAll(".gm-chip").forEach(function (btn) {
    btn.classList.toggle("is-active", selectedIds.has(btn.dataset.id));
  });
  updateCount();
}

function updateCount() {
  areaCount.textContent = selectedIds.size + " of " + areas.length + " shown";
}

function filterToggles() {
  var query = searchInput.value.toLowerCase().trim();
  toggleList.querySelectorAll(".gm-chip").forEach(function (btn) {
    var area = areas.find(function (a) { return a.id === btn.dataset.id; });
    btn.style.display = !query || area.name.toLowerCase().indexOf(query) !== -1 ? "" : "none";
  });
}

function buildTable() {
  var visible = areas.filter(function (a) { return selectedIds.has(a.id); });

  if (!visible.length) {
    tableHead.innerHTML = "";
    tableBody.innerHTML = '<tr><td class="gm-empty" colspan="1">Select neighborhoods above to compare.</td></tr>';
    return;
  }

  var sorted = visible.slice();
  if (sortKey) {
    sorted.sort(function (a, b) {
      var va = statValue(a, sortKey);
      var vb = statValue(b, sortKey);
      return sortDesc ? vb - va : va - vb;
    });
  }

  var meta = {};
  var winCounts = {};

  stats.forEach(function (stat) {
    var values = sorted.map(function (a) { return statValue(a, stat.key); });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var bestVal = stat.best === "min" ? min : max;
    var allTied = min === max;
    var winnerIds = allTied ? [] : sorted
      .filter(function (a) { return statValue(a, stat.key) === bestVal; })
      .map(function (a) { return a.id; });

    var unique = values.slice().sort(function (a, b) { return stat.best === "min" ? a - b : b - a; });
    unique = unique.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    var rankMap = {};
    unique.forEach(function (v, i) { rankMap[v] = i + 1; });

    meta[stat.key] = { min: min, max: max, range: range, winnerIds: winnerIds, rankMap: rankMap };

    if (!allTied) {
      winnerIds.forEach(function (id) {
        winCounts[id] = (winCounts[id] || 0) + 1;
      });
    }
  });

  var maxWins = Math.max.apply(null, Object.values(winCounts).concat([0]));
  var championIds = [];
  if (maxWins > 0) {
    Object.keys(winCounts).forEach(function (id) {
      if (winCounts[id] === maxWins) championIds.push(id);
    });
  }

  var headHtml = '<tr><th class="gm-label-cell gm-sticky-col"></th>';
  sorted.forEach(function (area) {
    var pc = (prayers[area.id] || []).length;
    var wins = winCounts[area.id] || 0;
    var isChampion = championIds.indexOf(area.id) !== -1;
    headHtml += '<th class="gm-area-header' + (isChampion ? " is-champion" : "") + '">';
    headHtml += '<span class="gm-area-name">' + escapeHtml(area.name) + "</span>";
    headHtml += '<span class="gm-area-meta">';
    headHtml += '<span class="gm-prayer-count">' + pc + " prayer" + (pc !== 1 ? "s" : "") + "</span>";
    if (wins > 0) {
      headHtml += ' &middot; <span class="gm-win-count">' + wins + " win" + (wins !== 1 ? "s" : "") + "</span>";
    }
    headHtml += "</span></th>";
  });
  headHtml += "</tr>";
  tableHead.innerHTML = headHtml;

  var bodyHtml = "";
  stats.forEach(function (stat) {
    var m = meta[stat.key];
    var isSorted = sortKey === stat.key;

    bodyHtml += '<tr class="gm-stat-row" data-stat="' + stat.key + '">';
    bodyHtml += '<td class="gm-label-cell gm-sticky-col" data-sort="' + stat.key + '" title="' + escapeHtml(stat.tip) + '">';
    bodyHtml += '<div class="gm-label-inner">';
    bodyHtml += '<i data-lucide="' + stat.icon + '" class="gm-stat-icon"></i>';
    bodyHtml += "<span>" + stat.label + "</span>";
    if (isSorted) {
      bodyHtml += '<span class="gm-sort-arrow">' + (sortDesc ? "\u2193" : "\u2191") + "</span>";
    }
    bodyHtml += "</div></td>";

    sorted.forEach(function (area) {
      var value = statValue(area, stat.key);
      var isWinner = m.winnerIds.indexOf(area.id) !== -1;
      var rank = m.rankMap[value] || 0;
      var isTop3 = rank >= 1 && rank <= 3;
      var pct;
      if (stat.best === "min") {
        pct = ((m.max - value) / m.range) * 100;
      } else {
        pct = ((value - m.min) / m.range) * 100;
      }

      var cls = "gm-cell";
      if (isWinner) cls += " is-winner";
      if (isTop3) cls += " is-top3";

      bodyHtml += '<td class="' + cls + '" data-rank="' + rank + '">';
      bodyHtml += '<span class="gm-bar" style="width:' + pct.toFixed(1) + '%"></span>';
      bodyHtml += '<span class="gm-value">' + stat.format(value) + "</span>";
      if (isWinner) bodyHtml += '<span class="gm-crown">\u2605</span>';
      bodyHtml += "</td>";
    });

    bodyHtml += "</tr>";
  });
  tableBody.innerHTML = bodyHtml;

  tableBody.querySelectorAll("[data-sort]").forEach(function (cell) {
    cell.addEventListener("click", function () {
      var key = cell.dataset.sort;
      if (sortKey === key) {
        if (sortDesc) {
          sortDesc = false;
        } else {
          sortKey = null;
          sortDesc = true;
        }
      } else {
        sortKey = key;
        sortDesc = true;
      }
      buildTable();
    });
  });

  refreshIcons();
}

function formatNumber(n) {
  return new Intl.NumberFormat().format(n);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
  });
}

function refreshIcons() {
  if (typeof lucide !== "undefined") {
    try { lucide.createIcons(); } catch (e) { /* ignore */ }
  }
}
