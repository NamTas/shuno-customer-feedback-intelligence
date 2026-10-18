const $ = (id) => document.getElementById(id);
const LABELS = { positive: "Positive", neutral: "Neutral", negative: "Negative" };
const CHART_COLORS = { positive: "#20a77c", neutral: "#e7b044", negative: "#e56870" };
const CLOUD_COLORS = {
  all: ["#2f6df6", "#16a276", "#6b5ee8", "#d18b22", "#2587a5", "#e56870"],
  positive: ["#159b70", "#20a77c", "#2786a3", "#70a99a", "#4c78c7"],
  negative: ["#e15a62", "#e58b54", "#bb6e83", "#c17c2b", "#8f6ab4"],
};
const AVATARS = ["#e5eeff", "#e6f8f1", "#fff2dd", "#f2eaff", "#ffe9eb", "#e3f5fa"];
const AVATAR_TEXT = ["#3468e8", "#16845f", "#b77c18", "#7853c4", "#d34c57", "#147d99"];
const state = {
  sentiment: "",
  query: "",
  cloud: "all",
  summary: null,
  trendChart: null,
  sentimentChart: null,
  showAll: false,
  year: "",
  product: "",
  view: "dashboard",
  volumeChart: null,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

async function api(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function notify(message, isError = false) {
  const box = $("message");
  box.textContent = message;
  box.className = "toast-message" + (isError ? " error" : "");
  box.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { box.hidden = true; }, 4000);
}

function percentage(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function formatDate(value) {
  if (!value) return "No date";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ratingFor(review) {
  if (review.rating !== null && review.rating !== undefined && Number.isFinite(Number(review.rating))) {
    return Math.max(0, Math.min(5, Math.round(Number(review.rating))));
  }
  return Math.max(1, Math.min(5, Math.round((Number(review.score || 0) + 1) * 2 + 1)));
}

function ratingStars(review) {
  const rating = ratingFor(review);
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

function renderMetrics(summary) {
  const total = summary.total || 0;
  const counts = summary.counts || { positive: 0, neutral: 0, negative: 0 };
  $("total").textContent = total.toLocaleString();
  for (const sentiment of Object.keys(LABELS)) {
    $(`${sentiment}Count`).textContent = (counts[sentiment] || 0).toLocaleString();
    $(`${sentiment}Pct`).textContent = `${percentage(counts[sentiment] || 0, total)}%`;
  }
  $("sideReviewCount").textContent = total > 99 ? "99+" : String(total);
  $("donutTotal").textContent = total.toLocaleString();
  $("alertDot").hidden = (counts.negative || 0) === 0;

  const legend = $("sentimentLegend");
  legend.replaceChildren();
  for (const sentiment of Object.keys(LABELS)) {
    const item = el("div", "sentiment-legend-item");
    const name = el("span", "legend-name");
    const dot = el("i", `legend-dot ${sentiment}-dot`);
    dot.style.background = CHART_COLORS[sentiment];
    name.append(dot, document.createTextNode(LABELS[sentiment]));
    item.append(name, el("strong", "", `${percentage(counts[sentiment] || 0, total)}%`));
    legend.append(item);
  }
}

function renderConcerns(keywords) {
  const container = $("concerns");
  if (!keywords || !keywords.length) {
    container.replaceChildren(el("p", "chart-empty", "No concerns to show yet. Add or import negative reviews."));
    return;
  }
  const max = Math.max(...keywords.map((item) => item[1]), 1);
  container.replaceChildren(...keywords.slice(0, 6).map(([word, count]) => {
    const row = el("div", "concern-row");
    const label = el("span", "concern-name", word);
    label.title = word;
    const track = el("div", "concern-track");
    const fill = el("div", "concern-fill");
    fill.style.width = `${Math.max(5, (count / max) * 100)}%`;
    track.append(fill);
    row.append(label, track, el("span", "concern-count", count));
    return row;
  }));
}

function renderCloud() {
  if (!state.summary) return;
  const words = (state.summary.cloud && state.summary.cloud[state.cloud]) || [];
  const container = $("cloud");
  if (!words.length) {
    container.replaceChildren(el("p", "chart-empty", state.summary.total ? "No frequent words in this filter." : "Add reviews to generate your word cloud."));
    return;
  }
  const max = Math.max(...words.map((item) => item[1]), 1);
  const colors = CLOUD_COLORS[state.cloud] || CLOUD_COLORS.all;
  container.replaceChildren(...words.map(([word, count], index) => {
    const button = el("button", "cloud-word", word);
    const scale = Math.sqrt(count / max);
    button.style.fontSize = `${12 + scale * 20}px`;
    button.style.color = colors[index % colors.length];
    button.title = `${count} mention${count === 1 ? "" : "s"}. Click to filter reviews.`;
    button.setAttribute("aria-label", `${word}, ${count} mentions. Filter reviews by this word.`);
    button.addEventListener("click", () => {
      state.query = word;
      $("search").value = word;
      state.sentiment = "";
      state.showAll = false;
      setActivePills("feedFilter", "data-sentiment", "");
      run(async () => { await refreshReviews(); });
      document.querySelector("#reviews").scrollIntoView({ behavior: "smooth", block: "start" });
      notify(`Showing reviews containing “${word}”.`);
    });
    return button;
  }));
}

function sentimentBadge(sentiment) {
  const safeSentiment = LABELS[sentiment] ? sentiment : "neutral";
  return el("span", `sentiment-badge ${safeSentiment}`, LABELS[safeSentiment]);
}

function renderFeed(reviews) {
  const tbody = $("feed");
  const allReviews = Array.isArray(reviews) ? reviews : [];
  const displayed = state.showAll ? allReviews : allReviews.slice(0, 5);
  if (!displayed.length) {
    const row = el("tr");
    const cell = el("td", "table-empty", state.query ? "No reviews match your search." : "No reviews to show. Import a CSV or add a review.");
    cell.colSpan = 5;
    row.append(cell);
    tbody.replaceChildren(row);
    $("reviewFooterCount").textContent = "Showing 0 reviews";
    $("viewAllBtn").hidden = true;
    return;
  }

  tbody.replaceChildren(...displayed.map((review) => {
    const row = el("tr");
    const customerCell = el("td");
    const customer = el("div", "customer-cell");
    const name = review.author || "Customer";
    const paletteIndex = Math.abs((name.codePointAt(0) || 0) % AVATARS.length);
    const avatar = el("span", "customer-avatar", name.slice(0, 1).toUpperCase());
    avatar.style.background = AVATARS[paletteIndex];
    avatar.style.color = AVATAR_TEXT[paletteIndex];
    const identity = el("div");
    identity.append(el("div", "customer-name", name));
    const stars = el("div", "star-rating", ratingStars(review));
    stars.setAttribute("aria-label", `${ratingFor(review)} out of 5 stars`);
    identity.append(stars);
    customer.append(avatar, identity);
    customerCell.append(customer);

    const reviewCell = el("td");
    reviewCell.append(el("div", "review-text", review.text));
    const dateCell = el("td", "date-cell", formatDate(review.reviewed_at));
    const sentimentCell = el("td");
    sentimentCell.append(sentimentBadge(review.sentiment));
    const actionCell = el("td");
    const analyze = el("button", "analyze-btn", "Details");
    analyze.type = "button";
    analyze.addEventListener("click", () => openAnalysis(review));
    actionCell.append(analyze);
    row.append(customerCell, reviewCell, dateCell, sentimentCell, actionCell);
    return row;
  }));
  $("reviewFooterCount").textContent = `Showing ${displayed.length} of ${allReviews.length} matching reviews`;
  $("viewAllBtn").hidden = allReviews.length <= 5;
  $("viewAllBtn").innerHTML = state.showAll ? 'Show fewer <span>↑</span>' : 'View all <span>→</span>';
}

async function renderTrend() {
  const points = await api(`/api/trend?${filterParams({ months: $("range").value })}`);
  const empty = $("trendEmpty");
  state.trendChart?.destroy();
  state.trendChart = null;
  if (typeof Chart === "undefined") {
    empty.hidden = false;
    empty.textContent = "Charts need an internet connection to load Chart.js.";
    return;
  }
  if (!points.length) {
    empty.hidden = false;
    empty.textContent = "Import reviews with a date column to see trends.";
    return;
  }
  empty.hidden = true;
  state.trendChart = new Chart($("trend"), {
    type: "line",
    data: {
      labels: points.map((point) => {
        const [year, month] = point.month.split("-").map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      }),
      datasets: [
        { label: "Positive", data: points.map((point) => point.positive), borderColor: CHART_COLORS.positive,
          backgroundColor: "rgba(32,167,124,.09)", fill: true, tension: .35, borderWidth: 2.5,
          pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: "#fff", pointBorderWidth: 2 },
        { label: "Negative", data: points.map((point) => point.negative), borderColor: CHART_COLORS.negative,
          backgroundColor: "rgba(229,104,112,.05)", fill: false, tension: .35, borderWidth: 2.5,
          pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: "#fff", pointBorderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.parsed.y}%`,
          afterBody: (items) => items.length ? `${points[items[0].dataIndex].count} reviews that month` : "" } },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 25, color: "#98a3b4", font: { size: 10 }, callback: (value) => `${value}%` },
          grid: { color: "#eff2f7", drawBorder: false }, border: { display: false } },
        x: { ticks: { color: "#98a3b4", font: { size: 10 }, maxRotation: 0, autoSkip: true },
          grid: { display: false }, border: { display: false } },
      },
    },
  });
}

function renderSentimentChart(summary) {
  if (typeof Chart === "undefined") return;
  state.sentimentChart?.destroy();
  state.sentimentChart = new Chart($("sentimentChart"), {
    type: "doughnut",
    data: {
      labels: ["Positive", "Neutral", "Negative"],
      datasets: [{ data: [summary.counts.positive, summary.counts.neutral, summary.counts.negative],
        backgroundColor: [CHART_COLORS.positive, CHART_COLORS.neutral, CHART_COLORS.negative],
        borderWidth: 4, borderColor: "#fff", hoverOffset: 5, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "74%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => {
        const total = context.dataset.data.reduce((sum, value) => sum + value, 0);
        const value = context.raw || 0;
        return `${context.label}: ${value} (${percentage(value, total)}%)`;
      } } } },
    },
  });
}

function openAnalysis(review) {
  const sentimentLabel = LABELS[review.sentiment] || "Neutral";
  const score = Number(review.score || 0);
  const normalizedScore = Math.round((score + 1) * 50);
  $("analyzeMeta").textContent = `${sentimentLabel} sentiment · ${formatDate(review.reviewed_at)} · ${review.author || "Customer"}`;
  $("analyzeText").textContent = review.text;
  $("analysisScore").textContent = `${score.toFixed(2)} (${normalizedScore}/100)`;
  const fill = $("analysisScoreFill");
  fill.style.width = `${normalizedScore}%`;
  fill.style.background = score >= 0.05 ? CHART_COLORS.positive : score <= -0.05 ? CHART_COLORS.negative : CHART_COLORS.neutral;
  $("analyzeDialog").showModal();
}

function setActivePills(containerId, dataName, value) {
  const attribute = `data-${dataName}`;
  document.querySelectorAll(`#${containerId} .filter-pill`).forEach((button) => {
    button.classList.toggle("active", button.getAttribute(attribute) === String(value));
  });
}

/* Filters shared by every request */
function filterParams(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ year: state.year, product: state.product, ...extra }).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function fillSelect(select, firstLabel, values, current) {
  select.replaceChildren(new Option(firstLabel, ""), ...values.map((value) => new Option(value, value)));
  select.value = values.includes(current) ? current : "";
  return select.value;
}

async function loadFilters() {
  const options = await api("/api/filters");
  state.year = fillSelect($("yearFilter"), "All dates", options.years, state.year);
  state.product = fillSelect($("productFilter"), "All products", options.products, state.product);
}

/* Analytics page */
function analyticsRow(label, content, valueText) {
  const row = el("div", "arow");
  const name = el("div", "aname", label);
  name.title = label;
  row.append(name, content, el("div", "aval", valueText));
  return row;
}

function barTrack(share, color) {
  const track = el("div", "atrack");
  const fill = el("div", "afill");
  fill.style.width = `${Math.max(share, 3)}%`;
  fill.style.background = color;
  track.append(fill);
  return track;
}

function renderWordBars(id, words, color) {
  const max = words.length ? words[0][1] : 1;
  $(id).replaceChildren(...(words.length
    ? words.map(([word, count]) => analyticsRow(word, barTrack((count / max) * 100, color), count))
    : [el("p", "chart-empty", "No words yet.")]));
}

function renderVolume(volume) {
  state.volumeChart?.destroy();
  state.volumeChart = null;
  $("volumeEmpty").hidden = volume.length > 0;
  if (!volume.length || typeof Chart === "undefined") return;
  const busiest = Math.max(...volume.map((item) => item.count));
  state.volumeChart = new Chart($("volumeChart"), {
    type: "bar",
    data: { labels: volume.map((item) => item.month),
      datasets: [{ data: volume.map((item) => item.count), borderRadius: 5,
        backgroundColor: volume.map((item) => (item.count === busiest ? "#3b6ff5" : "#bcd0fb")) }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.parsed.y.toLocaleString()} reviews` } } },
      scales: { y: { beginAtZero: true, ticks: { color: "#98a3b4", font: { size: 11 } }, grid: { color: "#eff2f7" }, border: { display: false } },
        x: { ticks: { color: "#98a3b4", font: { size: 11 }, maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { display: false } } } },
  });
}

function renderAnalytics({ stats, products, rating_by_sentiment: ratings, volume, words }) {
  $("aRating").textContent = stats.avg_rating ?? "–";
  $("aScore").textContent = stats.avg_score ?? "–";
  $("aRated").textContent = `${stats.rated_share}%`;
  const busiest = volume.length ? volume.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  $("aBusiest").textContent = busiest ? busiest.month : "–";
  $("aBusiestN").textContent = busiest ? `${busiest.count.toLocaleString()} reviews` : "No dates yet";

  $("productBars").replaceChildren(...(products.length ? products.map((item) => {
    const stack = el("div", "astack");
    Object.keys(LABELS).forEach((key) => {
      const part = el("div");
      part.style.cssText = `flex-grow:${item[key]};background:${CHART_COLORS[key]}`;
      part.title = `${LABELS[key]}: ${item[key].toLocaleString()}`;
      stack.append(part);
    });
    return analyticsRow(item.product, stack, (item.positive + item.neutral + item.negative).toLocaleString());
  }) : [el("p", "chart-empty", "No product column found in this data.")]));
  $("productLegend").replaceChildren(...Object.keys(LABELS).map((key) => {
    const item = el("span");
    const dot = el("i", "legend-dot");
    dot.style.background = CHART_COLORS[key];
    item.append(dot, document.createTextNode(` ${LABELS[key]}`));
    return item;
  }));

  const rated = Object.keys(LABELS).filter((key) => ratings[key] !== undefined);
  $("ratingBars").replaceChildren(...(rated.length
    ? rated.map((key) => analyticsRow(LABELS[key], barTrack((ratings[key] / 5) * 100, CHART_COLORS[key]), `${ratings[key]} / 5`))
    : [el("p", "chart-empty", "No rating column found in this data.")]));

  renderVolume(volume);
  renderWordBars("posWords", words.positive, CHART_COLORS.positive);
  renderWordBars("negWords", words.negative, CHART_COLORS.negative);
}

async function refreshAnalytics() {
  renderAnalytics(await api(`/api/analytics?${filterParams()}`));
}

function setView(view) {
  state.view = view;
  const titles = {
    dashboard: ["Customer Feedback Overview", "Understand what your customers love — and what needs attention.", "Dashboard"],
    analytics: ["Analytics", "Compare products, ratings, review volume and the words customers use.", "Analytics"],
  };
  document.body.classList.toggle("view-analytics", view === "analytics");
  [$("pageTitle").textContent, $("pageSubtitle").textContent, $("crumb").textContent] = titles[view];
}

async function refreshReviews() {
  const reviews = await api(`/api/reviews?${filterParams({ sentiment: state.sentiment, q: state.query })}`);
  renderFeed(reviews);
}

async function refresh() {
  await loadFilters();
  const summary = await api(`/api/summary?${filterParams()}`);
  state.summary = summary;
  renderMetrics(summary);
  renderCloud();
  renderConcerns(summary.complaints || []);
  renderSentimentChart(summary);
  await Promise.all([renderTrend(), refreshReviews(), state.view === "analytics" ? refreshAnalytics() : null]);
}

async function run(action) {
  try {
    await action();
    await refresh();
  } catch (error) {
    notify(error.message || "Something went wrong.", true);
  }
}

/* Navigation */
document.querySelectorAll("[data-nav]").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll("[data-nav]").forEach((item) => item.classList.toggle("active", item === link));
    const view = link.dataset.nav === "analytics" ? "analytics" : "dashboard";
    if (view !== state.view) { setView(view); run(async () => {}); }
  });
});

/* Word cloud sentiment toggle */
$("cloudFilter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-set]");
  if (!button) return;
  state.cloud = button.dataset.set;
  setActivePills("cloudFilter", "set", state.cloud);
  renderCloud();
});

/* Review feed sentiment filters */
$("feedFilter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sentiment]");
  if (!button) return;
  state.sentiment = button.dataset.sentiment;
  state.showAll = false;
  setActivePills("feedFilter", "sentiment", state.sentiment);
  run(async () => {});
});

$("search").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  state.showAll = false;
  run(async () => {});
});

$("range").addEventListener("change", () => run(async () => {}));
$("yearFilter").addEventListener("change", (event) => { state.year = event.target.value; state.showAll = false; run(async () => {}); });
$("productFilter").addEventListener("change", (event) => { state.product = event.target.value; state.showAll = false; run(async () => {}); });
$("addBtn").addEventListener("click", () => $("addDialog").showModal());
$("headingAddBtn").addEventListener("click", () => $("addDialog").showModal());
$("settingsBtn").addEventListener("click", () => $("settingsDialog").showModal());

$("bellBtn").addEventListener("click", () => {
  const negative = state.summary?.counts?.negative || 0;
  notify(negative ? `${negative.toLocaleString()} negative review${negative === 1 ? "" : "s"} may need attention.` : "No negative reviews right now.");
});

$("viewAllBtn").addEventListener("click", () => {
  state.showAll = !state.showAll;
  run(async () => {});
});

document.querySelectorAll(".more-btn").forEach((button) => {
  button.addEventListener("click", () => notify(button.dataset.info || "Chart based on the reviews currently stored in Shuno."));
});

$("addDialog").addEventListener("close", () => {
  if ($("addDialog").returnValue !== "ok") return;
  const text = $("newReview").value.trim();
  if (!text) { notify("Please enter review text first.", true); return; }
  run(async () => {
    await api("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    $("newReview").value = "";
    state.query = "";
    $("search").value = "";
    state.sentiment = "";
    setActivePills("feedFilter", "sentiment", "");
    state.showAll = false;
    notify("Review analyzed and added.");
  });
});

$("settingsDialog").addEventListener("close", () => {
  if ($("settingsDialog").returnValue !== "ok") return;
  run(async () => {
    await api("/api/reviews", { method: "DELETE" });
    state.query = "";
    state.sentiment = "";
    state.showAll = false;
    $("search").value = "";
    setActivePills("feedFilter", "sentiment", "");
    notify("All reviews deleted. Import a CSV or add a new review to start again.");
  });
});

$("csvInput").addEventListener("change", (event) => run(async () => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Please select a CSV file.");
  const form = new FormData();
  form.append("file", file);
  const result = await api("/api/import", { method: "POST", body: form });
  event.target.value = "";
  state.query = "";
  state.sentiment = "";
  state.showAll = false;
  $("search").value = "";
  setActivePills("feedFilter", "sentiment", "");
  notify(`Successfully imported ${result.imported.toLocaleString()} review${result.imported === 1 ? "" : "s"}.`);
}));

/* Small keyboard shortcut for the search box. */
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("search").focus();
  }
});

run(async () => {});
