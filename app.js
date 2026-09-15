// ---------- Storage ----------
const STORAGE_KEY = "reading-tracker-state-v2";
const OLD_STORAGE_KEY = "reading-tracker-state-v1";

function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem(OLD_STORAGE_KEY); // migrate from earlier version
    if (!raw) return { books: [], sessions: [], goals: [] };
    const parsed = JSON.parse(raw);
    return {
      books: parsed.books || [],
      sessions: parsed.sessions || [],
      goals: parsed.goals || [],
    };
  } catch (e) {
    console.warn("Could not read saved data, starting fresh.", e);
    return { books: [], sessions: [], goals: [] };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Could not save data (storage may be full or blocked).", e);
    alert("Couldn't save your changes — your browser's local storage may be full or disabled in this window.");
  }
}

let state = loadState();

// ---------- Utilities ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// Converts a Date (in local time) to a YYYY-MM-DD string without the UTC
// conversion in toISOString() shifting it to the wrong day.
function localISO(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Pages read counts only sessions logged during the book's CURRENT read-through
// (its "cycle") — a re-read starts a fresh cycle so progress doesn't carry
// over pages from a previous read.
function pagesReadForBook(bookId) {
  const book = state.books.find((b) => b.id === bookId);
  const cycle = book ? book.currentCycle || 1 : 1;
  return state.sessions
    .filter((s) => s.bookId === bookId && (s.cycle || 1) === cycle)
    .reduce((sum, s) => sum + s.pages, 0);
}

// Every completed read-through across the whole library — a book finished
// once contributes one event, and each past re-read contributes another.
function allCompletionEvents() {
  const events = [];
  state.books.forEach((b) => {
    (b.pastReads || []).forEach((pr) => events.push({ bookId: b.id, dateFinished: pr.dateFinished }));
    if (b.status === "finished" && b.dateFinished) events.push({ bookId: b.id, dateFinished: b.dateFinished });
  });
  return events;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function daysBetween(aISO, bISO) {
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function formatNiceDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------- Book cover helper ----------
function coverImgOrPlaceholder(coverUrl, alt) {
  if (coverUrl) {
    return `<img class="book-cover" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(alt)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'book-cover',textContent:'📕'}))" />`;
  }
  return `<div class="book-cover">📕</div>`;
}

// ---------- Star rating: interactive input ----------
function createStarInput(container, initialValue, onChange) {
  container.innerHTML = "";
  container.classList.add("star-input");
  let current = initialValue || 0;
  const units = [];

  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("span");
    s.className = "star-input-unit";
    s.textContent = "★";
    s.dataset.index = String(i);
    container.appendChild(s);
    units.push(s);
  }

  function paint(val) {
    units.forEach((s, idx) => {
      const starIndex = idx + 1;
      s.classList.remove("full", "half");
      if (val >= starIndex) s.classList.add("full");
      else if (val >= starIndex - 0.5) s.classList.add("half");
    });
  }

  function valueFromEvent(e) {
    const target = e.target.closest(".star-input-unit");
    if (!target) return null;
    const idx = Number(target.dataset.index);
    const rect = target.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    return frac < 0.5 ? idx - 0.5 : idx;
  }

  paint(current);
  container.addEventListener("mousemove", (e) => {
    const v = valueFromEvent(e);
    if (v != null) paint(v);
  });
  container.addEventListener("mouseleave", () => paint(current));
  container.addEventListener("click", (e) => {
    const v = valueFromEvent(e);
    if (v == null) return;
    current = current === v ? 0 : v; // click same value again to clear
    paint(current);
    if (onChange) onChange(current);
  });

  return {
    get: () => current,
    set: (v) => { current = v || 0; paint(current); },
  };
}

function starsReadOnlyHtml(rating) {
  if (!rating) return `<span class="stars-empty">Not rated yet</span>`;
  const pct = clamp((rating / 5) * 100, 0, 100);
  return `<span class="star-rating-display" title="${rating} / 5">
    <span class="stars-bg">★★★★★</span>
    <span class="stars-fg" style="width:${pct}%">★★★★★</span>
  </span>`;
}

// ---------- Rendering: Stats ----------
function renderStats() {
  const totalPages = state.sessions.reduce((s, x) => s + x.pages, 0);
  const totalMinutes = state.sessions.reduce((s, x) => s + x.minutes, 0);
  const finishedCount = allCompletionEvents().length;

  const daysWithSessions = new Set(state.sessions.map((s) => s.date));
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const iso = new Date(cursor.getTime() - cursor.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (daysWithSessions.has(iso)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  const tiles = [
    { label: "Books Finished", value: finishedCount },
    { label: "Pages Read", value: totalPages.toLocaleString() },
    { label: "Minutes Read", value: totalMinutes.toLocaleString() },
    { label: "Day Streak", value: streak },
  ];

  document.getElementById("stats-strip").innerHTML = tiles
    .map(
      (t) => `<div class="stat-tile"><div class="stat-value">${t.value}</div><div class="stat-label">${t.label}</div></div>`
    )
    .join("");
}

// ---------- Rendering: Goals ----------
// A recurring goal's window rolls forward automatically: its stored
// start/end is only the very first period ("anchor"); the period actually
// used for progress is whichever day/week/month contains today.
function getCurrentGoalPeriod(goal) {
  if (!goal.recurring) return { start: goal.start, end: goal.end };

  const anchor = new Date(goal.start + "T00:00:00");
  const now = new Date(todayISO() + "T00:00:00");

  if (goal.cadence === "day") {
    return { start: todayISO(), end: todayISO() };
  }

  if (goal.cadence === "week") {
    const diffDays = Math.floor((now - anchor) / 86400000);
    const periodIndex = Math.floor(diffDays / 7);
    const start = new Date(anchor);
    start.setDate(start.getDate() + periodIndex * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: localISO(start), end: localISO(end) };
  }

  // monthly
  let periodIndex = (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth());
  if (now.getDate() < anchor.getDate()) periodIndex--;
  periodIndex = Math.max(periodIndex, 0);
  const start = new Date(anchor);
  start.setMonth(start.getMonth() + periodIndex);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  return { start: localISO(start), end: localISO(end) };
}

function goalProgressValue(goal) {
  const period = getCurrentGoalPeriod(goal);
  if (goal.type === "book_count") {
    return allCompletionEvents().filter(
      (e) => e.dateFinished && e.dateFinished >= period.start && e.dateFinished <= period.end
    ).length;
  }
  if (goal.type === "page_count") {
    return state.sessions
      .filter((s) => s.date >= period.start && s.date <= period.end)
      .reduce((sum, s) => sum + s.pages, 0);
  }
  if (goal.type === "minute_count") {
    return state.sessions
      .filter((s) => s.date >= period.start && s.date <= period.end)
      .reduce((sum, s) => sum + s.minutes, 0);
  }
  return 0;
}

const GOAL_UNIT = { book_count: "books", page_count: "pages", minute_count: "minutes" };
const CADENCE_LABEL = { day: "daily", week: "weekly", month: "monthly" };

function renderGoals() {
  const list = document.getElementById("goals-list");
  if (state.goals.length === 0) {
    list.innerHTML = `<p class="empty-state">No goals yet. Set one to start tracking your pace.</p>`;
    return;
  }

  const today = todayISO();

  // Soonest deadline first; goals already reached sink to the bottom.
  const withPeriod = state.goals
    .map((goal) => {
      const period = getCurrentGoalPeriod(goal);
      const value = goalProgressValue(goal);
      const complete = value >= goal.target;
      const daysLeft = daysBetween(today, period.end);
      return { goal, period, value, complete, daysLeft };
    })
    .sort((a, b) => (a.complete !== b.complete ? (a.complete ? 1 : -1) : a.daysLeft - b.daysLeft));

  list.innerHTML = withPeriod
    .map(({ goal, period, value, complete, daysLeft }) => {
      const pct = clamp(Math.round((value / goal.target) * 100), 0, 100);
      const unit = GOAL_UNIT[goal.type];

      let paceNote;
      if (complete) {
        paceNote = "🎉 Goal reached!";
      } else if (daysLeft < 0 && !goal.recurring) {
        paceNote = "Goal window has ended";
      } else {
        const remaining = goal.target - value;
        const perDay = (remaining / Math.max(daysLeft, 1)).toFixed(1);
        paceNote = `${perDay} ${unit}/day needed`;
      }

      const typeLabel =
        goal.type === "book_count" ? "Finish books" : goal.type === "page_count" ? "Read pages" : "Reading time";
      const repeatBadge = goal.recurring ? `<span class="repeat-badge">↻ ${CADENCE_LABEL[goal.cadence]}</span>` : "";

      return `
        <div class="goal-card">
          <div class="goal-card-top">
            <div>
              <div class="goal-title">${typeLabel} ${repeatBadge}</div>
              <div class="goal-sub">${period.start} → ${period.end}</div>
            </div>
            <button class="btn-small danger" data-delete-goal="${goal.id}">Delete</button>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${complete ? "complete" : ""}" style="width:${pct}%"></div>
          </div>
          <div class="goal-meta">
            <span>${value} / ${goal.target} ${unit}</span>
            <span>${paceNote}</span>
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-delete-goal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this goal?")) return;
      state.goals = state.goals.filter((g) => g.id !== btn.dataset.deleteGoal);
      saveState();
      renderGoals();
    });
  });
}

// ---------- Pace / estimates ----------
// Reading speed is tracked in pages-per-minute, derived from actual logged
// (pages, minutes) pairs — using the recent window when available, falling
// back to the all-time average for a book with only older sessions.
function recentPagesPerMinute(bookId, windowDays) {
  windowDays = windowDays || 14;
  const cutoff = isoDaysAgo(windowDays);
  const recent = state.sessions.filter((s) => s.bookId === bookId && s.date >= cutoff);
  const totalMinutes = recent.reduce((a, s) => a + s.minutes, 0);
  if (totalMinutes <= 0) return null;
  const totalPages = recent.reduce((a, s) => a + s.pages, 0);
  return totalPages / totalMinutes;
}

function allTimePagesPerMinute(bookId) {
  const sessions = state.sessions.filter((s) => s.bookId === bookId);
  const totalMinutes = sessions.reduce((a, s) => a + s.minutes, 0);
  if (totalMinutes <= 0) return null;
  const totalPages = sessions.reduce((a, s) => a + s.pages, 0);
  return totalPages / totalMinutes;
}

function formatMinutes(totalMinutes) {
  const m = Math.round(totalMinutes);
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function estimateFinish(book) {
  if (!book.totalPages) return { text: "Add a total page count to see an estimate." };
  const read = pagesReadForBook(book.id);
  const remaining = book.totalPages - read;
  if (remaining <= 0) return { text: "Ready to mark as finished!" };

  const ppm = recentPagesPerMinute(book.id, 14) || allTimePagesPerMinute(book.id);
  if (!ppm || ppm <= 0) return { text: "Log a session to see an estimate." };

  const minutesNeeded = remaining / ppm;
  const pagesPerHour = ppm * 60;
  return {
    text: `Est. ${formatMinutes(minutesNeeded)} left at ~${pagesPerHour.toFixed(0)} pages/hour`,
    minutesNeeded,
    ppm,
  };
}

// ---------- Rendering: Books ----------
function bookCardHtml(book) {
  const pagesRead = pagesReadForBook(book.id);
  const total = book.totalPages || 0;
  const pct = total > 0 ? clamp(Math.round((pagesRead / total) * 100), 0, 100) : 0;

  let progressBlock = "";
  if (book.status === "reading" && total > 0) {
    const est = estimateFinish(book);
    progressBlock = `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
       <div class="book-progress-label"><span>${pagesRead} / ${total} pages</span><span>${pct}%</span></div>
       <div class="est-finish-line">${escapeHtml(est.text)}</div>`;
  } else if (book.status === "reading") {
    progressBlock = `<div class="book-progress-label"><span>${pagesRead} pages read</span><span></span></div>`;
  } else if (book.status === "dnf") {
    progressBlock = `<div class="book-progress-label"><span>${pagesRead} pages before stopping</span><span></span></div>`;
  }

  const ratingBlock = book.rating ? `<div class="book-rating-row">${starsReadOnlyHtml(book.rating)}</div>` : "";

  const actions = [];
  if (book.status === "to_read") {
    actions.push(`<button class="btn-small" data-log-session="${book.id}">Log session</button>`);
    actions.push(`<button class="btn-small" data-start-reading="${book.id}">Start reading</button>`);
  }
  if (book.status === "reading") {
    actions.push(`<button class="btn-small" data-log-session="${book.id}">Log session</button>`);
    actions.push(`<button class="btn-small" data-mark-finished="${book.id}">Mark finished</button>`);
    actions.push(`<button class="btn-small" data-mark-dnf="${book.id}">Did not finish</button>`);
  }
  if (book.status === "dnf") {
    actions.push(`<button class="btn-small" data-start-reading="${book.id}">Resume reading</button>`);
  }
  actions.push(`<button class="btn-small danger" data-delete-book="${book.id}">Remove</button>`);

  return `
    <div class="book-card" data-open-detail="${book.id}">
      <div class="book-card-top">
        ${coverImgOrPlaceholder(book.cover, book.title)}
        <div class="book-info">
          <div class="book-title">${escapeHtml(book.title)}</div>
          <div class="book-author">${escapeHtml(book.author || "Unknown author")}</div>
          ${ratingBlock}
        </div>
      </div>
      ${progressBlock}
      <div class="book-actions">${actions.join("")}</div>
    </div>`;
}

function wireBookCardActions(container) {
  container.querySelectorAll("[data-log-session]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLogSessionModal(btn.dataset.logSession);
    });
  });
  container.querySelectorAll("[data-start-reading]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const book = state.books.find((b) => b.id === btn.dataset.startReading);
      if (book) {
        book.status = "reading";
        saveState();
        renderAll();
      }
    });
  });
  container.querySelectorAll("[data-mark-finished]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFinishBookModal(btn.dataset.markFinished);
    });
  });
  container.querySelectorAll("[data-mark-dnf]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDnfModal(btn.dataset.markDnf);
    });
  });
  container.querySelectorAll("[data-delete-book]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("Remove this book and its logged sessions?")) return;
      const id = btn.dataset.deleteBook;
      state.books = state.books.filter((b) => b.id !== id);
      state.sessions = state.sessions.filter((s) => s.bookId !== id);
      saveState();
      renderAll();
    });
  });
  container.querySelectorAll("[data-open-detail]").forEach((card) => {
    card.addEventListener("click", () => openBookDetail(card.dataset.openDetail));
  });
}

let libraryQuery = "";
let librarySort = "added_desc";

function applyLibraryFilterSort(books) {
  let list = books;
  if (libraryQuery) {
    list = list.filter((b) => (b.title + " " + (b.author || "")).toLowerCase().includes(libraryQuery));
  }
  const sorted = [...list];
  if (librarySort === "title_asc") sorted.sort((a, b) => a.title.localeCompare(b.title));
  else if (librarySort === "author_asc") sorted.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
  else if (librarySort === "rating_desc") sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else sorted.sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""));
  return sorted;
}

function renderBooks() {
  const reading = applyLibraryFilterSort(state.books.filter((b) => b.status === "reading"));
  const toRead = applyLibraryFilterSort(state.books.filter((b) => b.status === "to_read"));
  const finished = applyLibraryFilterSort(state.books.filter((b) => b.status === "finished"));
  const dnf = applyLibraryFilterSort(state.books.filter((b) => b.status === "dnf"));

  const readingGrid = document.getElementById("reading-grid");
  readingGrid.innerHTML = reading.map(bookCardHtml).join("");
  document.getElementById("reading-empty").hidden = reading.length > 0;
  wireBookCardActions(readingGrid);

  const toReadEl = document.getElementById("shelf-to_read");
  toReadEl.innerHTML = toRead.length
    ? toRead.map(bookCardHtml).join("")
    : `<p class="empty-state">Nothing here yet.</p>`;
  wireBookCardActions(toReadEl);
  document.getElementById("count-to_read").textContent = toRead.length;

  const finishedEl = document.getElementById("shelf-finished");
  finishedEl.innerHTML = finished.length
    ? finished.map(bookCardHtml).join("")
    : `<p class="empty-state">Nothing here yet.</p>`;
  wireBookCardActions(finishedEl);
  document.getElementById("count-finished").textContent = finished.length;

  const dnfEl = document.getElementById("shelf-dnf");
  dnfEl.innerHTML = dnf.length
    ? dnf.map(bookCardHtml).join("")
    : `<p class="empty-state">Nothing here yet.</p>`;
  wireBookCardActions(dnfEl);
  document.getElementById("count-dnf").textContent = dnf.length;
}

document.getElementById("library-search").addEventListener("input", (e) => {
  libraryQuery = e.target.value.trim().toLowerCase();
  renderBooks();
});
document.getElementById("library-sort").addEventListener("change", (e) => {
  librarySort = e.target.value;
  renderBooks();
});

function renderAll() {
  renderStats();
  renderGoals();
  renderBooks();
  renderInsights();
}

// ---------- Modal helpers ----------
function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeModal(btn.dataset.close);
    if (btn.dataset.close === "modal-scanner") stopScanner();
    if (btn.dataset.close === "modal-log-session") stopTimerInterval();
  });
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.hidden = true;
      if (overlay.id === "modal-scanner") stopScanner();
      if (overlay.id === "modal-log-session") stopTimerInterval();
    }
  });
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).hidden = false;
    if (btn.dataset.tab === "insights") renderInsights();
  });
});

// ---------- Add Book: search ----------
let searchDebounceTimer = null;

document.getElementById("btn-open-add-book").addEventListener("click", () => {
  document.getElementById("book-search-input").value = "";
  document.getElementById("search-results").innerHTML = "";
  document.getElementById("search-status").textContent = "";
  document.getElementById("isbn-input").value = "";
  document.getElementById("isbn-status").textContent = "";
  document.getElementById("manual-book-form").reset();
  document.getElementById("manual-finished-extra").hidden = true;
  openModal("modal-add-book");
  document.getElementById("book-search-input").focus();
});

document.getElementById("book-search-input").addEventListener("input", (e) => {
  const query = e.target.value.trim();
  clearTimeout(searchDebounceTimer);
  const statusEl = document.getElementById("search-status");
  const resultsEl = document.getElementById("search-results");

  if (query.length < 2) {
    resultsEl.innerHTML = "";
    statusEl.textContent = "";
    return;
  }

  statusEl.textContent = "Searching…";
  searchDebounceTimer = setTimeout(() => runBookSearch(query), 350);
});

document.getElementById("search-mode").addEventListener("change", () => {
  const mode = document.getElementById("search-mode").value;
  const input = document.getElementById("book-search-input");
  input.placeholder =
    mode === "author" ? "e.g. Andy Weir" : mode === "genre" ? "e.g. fantasy, biography, mystery" : "e.g. Project Hail Mary";
  if (input.value.trim().length >= 2) runBookSearch(input.value.trim());
});

async function fetchByTitleOrAuthor(query, mode) {
  const qParam = mode === "author" ? `author:${query}` : query;
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
    qParam
  )}&fields=title,author_name,cover_i,number_of_pages_median,first_publish_year&limit=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Bad response: " + res.status);
  const data = await res.json();
  return (data.docs || [])
    .filter((d) => d.title)
    .map((d) => ({
      title: d.title,
      author: d.author_name ? d.author_name[0] : "",
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
      coverSmall: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : "",
      totalPages: d.number_of_pages_median || null,
      year: d.first_publish_year || null,
    }));
}

async function fetchByGenre(query, limit) {
  const slug = query.trim().toLowerCase().replace(/\s+/g, "_");
  const url = `https://openlibrary.org/subjects/${encodeURIComponent(slug)}.json?limit=${limit || 8}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Bad response: " + res.status);
  const data = await res.json();
  return (data.works || []).map((w) => ({
    title: w.title,
    author: w.authors && w.authors[0] ? w.authors[0].name : "",
    cover: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : "",
    coverSmall: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-S.jpg` : "",
    totalPages: null,
    year: w.first_publish_year || null,
    subjects: w.subject || [],
  }));
}

async function runBookSearch(query) {
  const statusEl = document.getElementById("search-status");
  const resultsEl = document.getElementById("search-results");
  const mode = document.getElementById("search-mode").value;

  try {
    const items = mode === "genre" ? await fetchByGenre(query, 8) : await fetchByTitleOrAuthor(query, mode);

    if (items.length === 0) {
      statusEl.textContent = "No matches — try a different search, or enter it manually below.";
      resultsEl.innerHTML = "";
      return;
    }

    statusEl.textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;
    renderSearchResults(items);
  } catch (err) {
    console.warn("Book search failed", err);
    statusEl.textContent = "Couldn't reach the book search service — enter the details manually below.";
    resultsEl.innerHTML = "";
  }
}

function renderSearchResults(items) {
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = items
    .map(
      (d, i) => `
      <div class="search-result" data-idx="${i}">
        ${d.coverSmall ? `<img class="search-result-cover" src="${escapeHtml(d.coverSmall)}" alt="" />` : `<div class="search-result-cover"></div>`}
        <div class="search-result-text">
          <div class="search-result-title">${escapeHtml(d.title)}</div>
          <div class="search-result-sub">${escapeHtml(d.author || "Unknown author")}${d.year ? " · " + d.year : ""}${
            d.totalPages ? " · ~" + d.totalPages + "p" : ""
          }</div>
        </div>
      </div>`
    )
    .join("");

  resultsEl.querySelectorAll(".search-result").forEach((el) => {
    el.addEventListener("click", () => {
      const d = items[Number(el.dataset.idx)];
      prefillManualForm(d);
      document.getElementById("search-status").textContent = `Selected "${d.title}" — review details below and click Add Book.`;
    });
  });
}

function prefillManualForm(d) {
  document.getElementById("manual-title").value = d.title || "";
  document.getElementById("manual-author").value = d.author || "";
  document.getElementById("manual-pages").value = d.totalPages || "";
  document.getElementById("manual-cover").value = d.cover || "";
  document.getElementById("manual-isbn").value = d.isbn || "";
}

// ---------- Add Book: ISBN lookup ----------
document.getElementById("btn-isbn-lookup").addEventListener("click", async () => {
  const isbn = document.getElementById("isbn-input").value.trim().replace(/[-\s]/g, "");
  const statusEl = document.getElementById("isbn-status");
  if (!isbn) {
    statusEl.textContent = "Enter an ISBN first.";
    return;
  }
  statusEl.textContent = "Looking up…";
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`);
    if (!res.ok) throw new Error("Bad response: " + res.status);
    const data = await res.json();
    const key = "ISBN:" + isbn;
    const book = data[key];
    if (!book) {
      statusEl.textContent = "No book found for that ISBN — try manual entry below.";
      return;
    }
    prefillManualForm({
      title: book.title,
      author: book.authors && book.authors[0] ? book.authors[0].name : "",
      cover: book.cover ? book.cover.medium || book.cover.large || "" : "",
      totalPages: book.number_of_pages || null,
      isbn,
    });
    statusEl.textContent = `Found "${book.title}" — review details below and click Add Book.`;
  } catch (err) {
    console.warn("ISBN lookup failed", err);
    statusEl.textContent = "Couldn't reach the lookup service — enter the details manually below.";
  }
});

// ---------- Add Book: barcode scanner ----------
let scannerInstance = null;

document.getElementById("btn-scan-barcode").addEventListener("click", async () => {
  const statusEl = document.getElementById("scanner-status");
  statusEl.textContent = "Starting camera…";
  openModal("modal-scanner");

  if (typeof Html5Qrcode === "undefined") {
    statusEl.textContent = "Scanner library failed to load — enter the ISBN manually instead.";
    return;
  }

  try {
    scannerInstance = new Html5Qrcode("scanner-region");
    await scannerInstance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 120 } },
      (decodedText) => {
        document.getElementById("isbn-input").value = decodedText.replace(/[-\s]/g, "");
        closeModal("modal-scanner");
        stopScanner();
        document.getElementById("btn-isbn-lookup").click();
      },
      () => {} // ignore per-frame decode failures
    );
    statusEl.textContent = "Point your camera at the barcode.";
  } catch (err) {
    console.warn("Camera scan failed", err);
    statusEl.textContent = "Couldn't access the camera — enter the ISBN manually instead.";
  }
});

function stopScanner() {
  if (scannerInstance) {
    scannerInstance.stop().catch(() => {});
    scannerInstance.clear().catch(() => {});
    scannerInstance = null;
  }
}

// ---------- Add Book: manual form / finished-extra toggle ----------
let manualRatingWidget = null;

document.getElementById("manual-status").addEventListener("change", (e) => {
  const extra = document.getElementById("manual-finished-extra");
  if (e.target.value === "finished") {
    extra.hidden = false;
    if (!manualRatingWidget) {
      manualRatingWidget = createStarInput(document.getElementById("manual-rating-stars"), 0);
    }
  } else {
    extra.hidden = true;
  }
});

document.getElementById("manual-book-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = document.getElementById("manual-title").value.trim();
  if (!title) return;
  const author = document.getElementById("manual-author").value.trim();
  const pages = Number(document.getElementById("manual-pages").value) || null;
  const status = document.getElementById("manual-status").value;
  const cover = document.getElementById("manual-cover").value || "";
  const isbn = document.getElementById("manual-isbn").value || "";

  const book = {
    id: uid(),
    title,
    author,
    totalPages: pages,
    cover,
    isbn,
    status,
    dateAdded: todayISO(),
    dateFinished: null,
    rating: null,
    review: "",
    currentCycle: 1,
    pastReads: [],
  };

  if (status === "finished") {
    book.dateFinished = todayISO();
    book.rating = manualRatingWidget ? manualRatingWidget.get() || null : null;
    book.review = document.getElementById("manual-review").value.trim();
  }

  state.books.push(book);
  saveState();
  closeModal("modal-add-book");
  renderAll();
});

// ---------- Log Session: in-page timer ----------
let sessionTimer = { elapsedSeconds: 0, intervalId: null };
let minutesMode = "timer";

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function updateTimerDisplay() {
  document.getElementById("timer-display").textContent = formatTimer(sessionTimer.elapsedSeconds);
}

function stopTimerInterval() {
  clearInterval(sessionTimer.intervalId);
  sessionTimer.intervalId = null;
}

function resetTimer() {
  stopTimerInterval();
  sessionTimer.elapsedSeconds = 0;
  updateTimerDisplay();
  document.getElementById("timer-start").hidden = false;
  document.getElementById("timer-pause").hidden = true;
  document.getElementById("timer-resume").hidden = true;
}

document.getElementById("timer-start").addEventListener("click", () => {
  sessionTimer.intervalId = setInterval(() => {
    sessionTimer.elapsedSeconds++;
    updateTimerDisplay();
  }, 1000);
  document.getElementById("timer-start").hidden = true;
  document.getElementById("timer-pause").hidden = false;
});
document.getElementById("timer-pause").addEventListener("click", () => {
  stopTimerInterval();
  document.getElementById("timer-pause").hidden = true;
  document.getElementById("timer-resume").hidden = false;
});
document.getElementById("timer-resume").addEventListener("click", () => {
  sessionTimer.intervalId = setInterval(() => {
    sessionTimer.elapsedSeconds++;
    updateTimerDisplay();
  }, 1000);
  document.getElementById("timer-resume").hidden = true;
  document.getElementById("timer-pause").hidden = false;
});
document.getElementById("timer-reset").addEventListener("click", resetTimer);

document.querySelectorAll("[data-minutes-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-minutes-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    minutesMode = btn.dataset.minutesMode;
    document.getElementById("minutes-timer-mode").hidden = minutesMode !== "timer";
    document.getElementById("minutes-manual-mode").hidden = minutesMode !== "manual";
  });
});

// ---------- Log Session ----------
function openLogSessionModal(preselectBookId) {
  const select = document.getElementById("session-book");
  const eligible = state.books.filter((b) => b.status !== "finished" && b.status !== "dnf");
  if (eligible.length === 0) {
    alert("Add a book first (or move one out of Finished) before logging a session.");
    return;
  }
  select.innerHTML = eligible.map((b) => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join("");
  if (preselectBookId) select.value = preselectBookId;
  document.getElementById("session-date").value = todayISO();
  document.getElementById("session-pages").value = "";
  document.getElementById("session-minutes-manual").value = "";
  document.getElementById("session-note").value = "";
  resetTimer();
  minutesMode = "timer";
  document.querySelectorAll("[data-minutes-mode]").forEach((b) => b.classList.toggle("active", b.dataset.minutesMode === "timer"));
  document.getElementById("minutes-timer-mode").hidden = false;
  document.getElementById("minutes-manual-mode").hidden = true;
  openModal("modal-log-session");
}

document.getElementById("log-session-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const bookId = document.getElementById("session-book").value;
  const date = document.getElementById("session-date").value || todayISO();
  const pages = Number(document.getElementById("session-pages").value);
  const minutes =
    minutesMode === "timer"
      ? Math.round((sessionTimer.elapsedSeconds / 60) * 10) / 10
      : Number(document.getElementById("session-minutes-manual").value);
  const note = document.getElementById("session-note").value.trim();
  if (!bookId || !pages) return;
  if (!minutes || minutes <= 0) {
    alert(minutesMode === "timer" ? "Start the timer before saving, or switch to entering time manually." : "Enter the minutes you spent reading.");
    return;
  }

  stopTimerInterval();
  const book = state.books.find((b) => b.id === bookId);
  const cycle = book ? book.currentCycle || 1 : 1;
  state.sessions.push({ id: uid(), bookId, date, pages, minutes, note, cycle, createdAt: Date.now() });
  saveState();
  closeModal("modal-log-session");
  renderAll();

  if (book && book.totalPages && pagesReadForBook(book.id) >= book.totalPages && book.status !== "finished") {
    if (confirm(`Looks like you've finished "${book.title}"! Mark it as finished now?`)) {
      openFinishBookModal(book.id);
    }
  }
});

// ---------- Finish Book modal ----------
let finishRatingWidget = null;

function openFinishBookModal(bookId) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;
  document.getElementById("finish-book-id").value = bookId;
  document.getElementById("finish-date").value = todayISO();
  document.getElementById("finish-review").value = book.review || "";
  finishRatingWidget = createStarInput(document.getElementById("finish-rating-stars"), book.rating || 0);
  openModal("modal-finish-book");
}

document.getElementById("finish-book-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const bookId = document.getElementById("finish-book-id").value;
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;
  book.status = "finished";
  book.dateFinished = document.getElementById("finish-date").value || todayISO();
  book.rating = finishRatingWidget ? finishRatingWidget.get() || null : null;
  book.review = document.getElementById("finish-review").value.trim();
  saveState();
  closeModal("modal-finish-book");
  renderAll();
});

// ---------- Did Not Finish modal ----------
function openDnfModal(bookId) {
  document.getElementById("dnf-book-id").value = bookId;
  document.getElementById("dnf-date").value = todayISO();
  document.getElementById("dnf-reason").value = "";
  openModal("modal-dnf");
}

document.getElementById("dnf-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const bookId = document.getElementById("dnf-book-id").value;
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;
  book.status = "dnf";
  book.dnfDate = document.getElementById("dnf-date").value || todayISO();
  book.dnfReason = document.getElementById("dnf-reason").value.trim();
  saveState();
  closeModal("modal-dnf");
  renderAll();
});

// ---------- Book Detail modal ----------
let detailRatingWidget = null;

function openBookDetail(bookId) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return;

  document.getElementById("detail-title").textContent = book.title;
  document.getElementById("detail-cover").innerHTML = coverImgOrPlaceholder(book.cover, book.title);
  document.getElementById("detail-author").textContent = book.author || "Unknown author";
  const statusLabel =
    book.status === "reading"
      ? "Currently Reading"
      : book.status === "finished"
      ? `Finished ${book.dateFinished ? formatNiceDate(book.dateFinished) : ""}`
      : book.status === "dnf"
      ? `Did Not Finish${book.dnfDate ? " · " + formatNiceDate(book.dnfDate) : ""}${book.dnfReason ? " — " + book.dnfReason : ""}`
      : "Want to Read";
  document.getElementById("detail-status").textContent = statusLabel;
  document.getElementById("detail-review").value = book.review || "";
  detailRatingWidget = createStarInput(document.getElementById("detail-rating-stars"), book.rating || 0);

  document.getElementById("btn-save-review").onclick = () => {
    book.rating = detailRatingWidget.get() || null;
    book.review = document.getElementById("detail-review").value.trim();
    saveState();
    renderAll();
    closeModal("modal-book-detail");
  };

  // Read Again: files the current read into pastReads and starts a fresh cycle.
  const actionsRow = document.getElementById("detail-actions-row");
  actionsRow.hidden = book.status !== "finished";
  document.getElementById("btn-read-again").onclick = () => {
    book.pastReads = book.pastReads || [];
    book.pastReads.push({
      cycle: book.currentCycle || 1,
      dateFinished: book.dateFinished,
      rating: book.rating,
      review: book.review,
    });
    book.currentCycle = (book.currentCycle || 1) + 1;
    book.status = "reading";
    book.dateFinished = null;
    book.rating = null;
    book.review = "";
    saveState();
    renderAll();
    openBookDetail(bookId);
  };

  const pastReads = book.pastReads || [];
  document.getElementById("detail-past-reads").hidden = pastReads.length === 0;
  document.getElementById("detail-past-reads-list").innerHTML = pastReads
    .map(
      (pr) => `
      <div class="detail-session-row">
        <div class="detail-session-main">
          <strong>Read #${pr.cycle}</strong> — finished ${pr.dateFinished ? formatNiceDate(pr.dateFinished) : "unknown date"}
          ${pr.rating ? `<div style="margin-top:4px;">${starsReadOnlyHtml(pr.rating)}</div>` : ""}
          ${pr.review ? `<div class="detail-session-note">"${escapeHtml(pr.review)}"</div>` : ""}
        </div>
      </div>`
    )
    .join("");

  // More by this author
  const moreEl = document.getElementById("detail-author-more");
  moreEl.innerHTML = "";
  document.getElementById("btn-more-by-author").onclick = async () => {
    if (!book.author) {
      moreEl.innerHTML = `<p class="empty-state">No author on file for this book.</p>`;
      return;
    }
    moreEl.innerHTML = `<p class="search-status">Searching…</p>`;
    try {
      const items = await fetchByTitleOrAuthor(book.author, "author");
      const filtered = items.filter((it) => it.title.toLowerCase().trim() !== book.title.toLowerCase().trim()).slice(0, 6);
      if (filtered.length === 0) {
        moreEl.innerHTML = `<p class="empty-state">Nothing else found for this author.</p>`;
        return;
      }
      moreEl.innerHTML = filtered
        .map(
          (it, i) => `
        <div class="search-result" data-more-idx="${i}">
          ${it.coverSmall ? `<img class="search-result-cover" src="${escapeHtml(it.coverSmall)}" alt="" />` : `<div class="search-result-cover"></div>`}
          <div class="search-result-text">
            <div class="search-result-title">${escapeHtml(it.title)}</div>
            <div class="search-result-sub">${it.year ? it.year : ""}</div>
          </div>
        </div>`
        )
        .join("");
      moreEl.querySelectorAll("[data-more-idx]").forEach((el) => {
        el.addEventListener("click", () => {
          const it = filtered[Number(el.dataset.moreIdx)];
          closeModal("modal-book-detail");
          document.getElementById("book-search-input").value = "";
          document.getElementById("search-results").innerHTML = "";
          document.getElementById("isbn-input").value = "";
          document.getElementById("isbn-status").textContent = "";
          document.getElementById("manual-finished-extra").hidden = true;
          openModal("modal-add-book");
          prefillManualForm(it);
          document.getElementById("search-status").textContent = `Selected "${it.title}" — review details below and click Add Book.`;
        });
      });
    } catch (err) {
      console.warn("More-by-author lookup failed", err);
      moreEl.innerHTML = `<p class="empty-state">Couldn't reach the lookup service.</p>`;
    }
  };

  const sessions = state.sessions
    .filter((s) => s.bookId === bookId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const sessionsEl = document.getElementById("detail-sessions");
  sessionsEl.innerHTML = sessions.length
    ? sessions
        .map(
          (s) => `
      <div class="detail-session-row" data-session-id="${s.id}">
        <div class="detail-session-main">
          <strong>${formatNiceDate(s.date)}</strong> — ${s.pages} pages, ${s.minutes} min${pastReads.length ? ` · Read #${s.cycle || 1}` : ""}
          ${s.note ? `<div class="detail-session-note">"${escapeHtml(s.note)}"</div>` : ""}
        </div>
        <button class="detail-session-del" data-del-session="${s.id}" title="Delete session">✕</button>
      </div>`
        )
        .join("")
    : `<p class="empty-state">No sessions logged yet.</p>`;

  sessionsEl.querySelectorAll("[data-del-session]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this session log?")) return;
      state.sessions = state.sessions.filter((s) => s.id !== btn.dataset.delSession);
      saveState();
      renderAll();
      openBookDetail(bookId);
    });
  });

  openModal("modal-book-detail");
}

// ---------- Goals ----------
function computeEndDate(startISO, duration) {
  const d = new Date(startISO + "T00:00:00");
  switch (duration) {
    case "day": d.setDate(d.getDate() + 1); break;
    case "week": d.setDate(d.getDate() + 7); break;
    case "month": d.setMonth(d.getMonth() + 1); break;
    case "quarter": d.setMonth(d.getMonth() + 3); break;
    case "half_year": d.setMonth(d.getMonth() + 6); break;
    case "year": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

const RECURRING_DURATIONS = ["day", "week", "month"];

function updateGoalEndPreview() {
  const duration = document.getElementById("goal-duration").value;
  const start = document.getElementById("goal-start").value || todayISO();
  const previewEl = document.getElementById("goal-end-preview");
  const customRow = document.getElementById("goal-custom-end-row");
  const repeatRow = document.getElementById("goal-repeat-row");

  const canRepeat = RECURRING_DURATIONS.includes(duration);
  repeatRow.hidden = !canRepeat;
  if (!canRepeat) document.getElementById("goal-repeat").checked = false;

  if (duration === "custom") {
    customRow.hidden = false;
    previewEl.textContent = "";
  } else {
    customRow.hidden = true;
    previewEl.textContent = `Ends ${formatNiceDate(computeEndDate(start, duration))}`;
  }
}

document.getElementById("btn-open-goal").addEventListener("click", () => {
  document.getElementById("goal-form").reset();
  document.getElementById("goal-start").value = todayISO();
  document.getElementById("goal-duration").value = "month";
  document.getElementById("goal-repeat").checked = false;
  updateGoalTargetLabel();
  updateGoalEndPreview();
  openModal("modal-goal");
});

function updateGoalTargetLabel() {
  const type = document.getElementById("goal-type").value;
  const label = type === "book_count" ? "Target (books)" : type === "page_count" ? "Target (pages)" : "Target (minutes)";
  document.getElementById("goal-target-label").textContent = label;
}
document.getElementById("goal-type").addEventListener("change", updateGoalTargetLabel);
document.getElementById("goal-duration").addEventListener("change", updateGoalEndPreview);
document.getElementById("goal-start").addEventListener("change", updateGoalEndPreview);

document.getElementById("goal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const type = document.getElementById("goal-type").value;
  const target = Number(document.getElementById("goal-target").value);
  const start = document.getElementById("goal-start").value;
  const duration = document.getElementById("goal-duration").value;
  const end = duration === "custom" ? document.getElementById("goal-end").value : computeEndDate(start, duration);
  if (!target || !start || !end) return;

  const recurring = document.getElementById("goal-repeat").checked && RECURRING_DURATIONS.includes(duration);

  state.goals.push({
    id: uid(),
    type,
    target,
    start,
    end,
    recurring,
    cadence: recurring ? duration : null,
    createdAt: Date.now(),
  });
  saveState();
  closeModal("modal-goal");
  renderAll();
});

// ---------- Shelves toggle ----------
document.querySelectorAll(".shelf-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.shelf;
    const body = document.getElementById("shelf-" + key);
    body.hidden = !body.hidden;
    btn.classList.toggle("open", !body.hidden);
  });
});

// ---------- Insights tab ----------
let paceChartInstance = null;
let chartRange = "14d";

function speedForSessions(sessions) {
  const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  if (totalMinutes <= 0) return null;
  const totalPages = sessions.reduce((sum, s) => sum + s.pages, 0);
  return Math.round((totalPages / totalMinutes) * 60 * 10) / 10;
}

// Builds {labels, values} for the pace chart at a given range: daily buckets
// for 14 days, weekly buckets for 90 days, monthly buckets for all time.
function computeChartSeries(range) {
  if (range === "14d") {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(isoDaysAgo(i));
    const values = days.map((d) => speedForSessions(state.sessions.filter((s) => s.date === d)));
    const labels = days.map((d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    return { labels, values };
  }

  if (range === "90d") {
    const weeks = [];
    for (let i = 12; i >= 0; i--) weeks.push({ start: isoDaysAgo(i * 7 + 6), end: isoDaysAgo(i * 7) });
    const values = weeks.map(({ start, end }) =>
      speedForSessions(state.sessions.filter((s) => s.date >= start && s.date <= end))
    );
    const labels = weeks.map(({ start }) => new Date(start + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    return { labels, values };
  }

  // all time: one bucket per calendar month, from the first logged session to now
  if (state.sessions.length === 0) return { labels: [], values: [] };
  const firstDate = new Date([...state.sessions].sort((a, b) => (a.date < b.date ? -1 : 1))[0].date + "T00:00:00");
  const now = new Date(todayISO() + "T00:00:00");
  const months = [];
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  while (cursor <= now) {
    const start = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    const end = localISO(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    months.push({ start, end, label: cursor.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const values = months.map(({ start, end }) => speedForSessions(state.sessions.filter((s) => s.date >= start && s.date <= end)));
  const labels = months.map((m) => m.label);
  return { labels, values };
}

function renderPaceChart() {
  const { labels, values } = computeChartSeries(chartRange);
  const hasAnyData = values.some((v) => v != null);

  const canvas = document.getElementById("pace-chart");
  document.getElementById("pace-chart-empty").hidden = hasAnyData;
  canvas.hidden = !hasAnyData;

  document.getElementById("pace-chart-sub").textContent =
    chartRange === "14d"
      ? "Pages per hour on each day you logged a session."
      : chartRange === "90d"
      ? "Pages per hour, averaged per week, over the last 90 days."
      : "Pages per hour, averaged per month, since your first logged session.";

  if (!hasAnyData || typeof Chart === "undefined") return;

  if (paceChartInstance) paceChartInstance.destroy();
  const styles = getComputedStyle(document.body);
  const accent = styles.getPropertyValue("--accent").trim() || "#a1543a";
  paceChartInstance = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Pages / hour",
          data: values,
          spanGaps: true,
          tension: 0.3,
          borderColor: accent,
          backgroundColor: accent,
          pointRadius: 5,
          pointHoverRadius: 6,
          pointBackgroundColor: accent,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: styles.getPropertyValue("--text-muted").trim() } },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Pages / hour", color: styles.getPropertyValue("--text-muted").trim() },
          ticks: { precision: 0, color: styles.getPropertyValue("--text-muted").trim() },
          grid: { color: styles.getPropertyValue("--border").trim() },
        },
      },
    },
  });
}

document.querySelectorAll("[data-chart-range]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-chart-range]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chartRange = btn.dataset.chartRange;
    renderPaceChart();
  });
});

function renderEstimates() {
  const reading = state.books.filter((b) => b.status === "reading");
  const listEl = document.getElementById("estimates-list");
  document.getElementById("estimates-empty").hidden = reading.length > 0;

  listEl.innerHTML = reading
    .map((book) => {
      const est = estimateFinish(book);
      const read = pagesReadForBook(book.id);
      return `<div class="estimate-row">
        <span class="estimate-book">${escapeHtml(book.title)}</span>
        <span class="estimate-detail">${book.totalPages ? read + " / " + book.totalPages + " pages<br/>" : ""}${escapeHtml(est.text)}</span>
      </div>`;
    })
    .join("");
}

// ---------- Monthly review ----------
function renderMonthlyReview() {
  const ym = document.getElementById("review-month").value;
  if (!ym) return;
  const [y, m] = ym.split("-").map(Number);
  const startISO = `${ym}-01`;
  const endISO = localISO(new Date(y, m, 0));

  const sessionsInMonth = state.sessions.filter((s) => s.date >= startISO && s.date <= endISO);
  const totalPages = sessionsInMonth.reduce((sum, s) => sum + s.pages, 0);
  const totalMinutes = sessionsInMonth.reduce((sum, s) => sum + s.minutes, 0);
  const booksFinished = allCompletionEvents().filter((e) => e.dateFinished >= startISO && e.dateFinished <= endISO);

  const minutesByBook = {};
  sessionsInMonth.forEach((s) => {
    minutesByBook[s.bookId] = (minutesByBook[s.bookId] || 0) + s.minutes;
  });
  let longestBook = null;
  let longestMinutes = 0;
  Object.entries(minutesByBook).forEach(([bookId, mins]) => {
    if (mins > longestMinutes) {
      longestMinutes = mins;
      longestBook = state.books.find((b) => b.id === bookId);
    }
  });

  const hasData = sessionsInMonth.length > 0 || booksFinished.length > 0;
  document.getElementById("review-empty").hidden = hasData;

  if (!hasData) {
    document.getElementById("review-stats").innerHTML = "";
    return;
  }

  const tiles = [
    { label: "Books Finished", value: booksFinished.length },
    { label: "Pages Read", value: totalPages.toLocaleString() },
    { label: "Minutes Read", value: totalMinutes.toLocaleString() },
  ];
  let html = tiles
    .map((t) => `<div class="stat-tile"><div class="stat-value">${t.value}</div><div class="stat-label">${t.label}</div></div>`)
    .join("");

  if (longestBook) {
    html += `<div class="wrapped-highlight">📖 Spent the most time with<strong>${escapeHtml(longestBook.title)}</strong>${formatMinutes(longestMinutes)} this month</div>`;
  }

  document.getElementById("review-stats").innerHTML = html;
}

document.getElementById("review-month").addEventListener("change", renderMonthlyReview);

// ---------- Reading calendar heatmap ----------
function renderCalendarHeatmap() {
  const container = document.getElementById("calendar-heatmap");
  const totalDays = 371; // ~53 weeks, so the grid divides evenly into week-columns
  const days = [];
  for (let i = totalDays - 1; i >= 0; i--) days.push(isoDaysAgo(i));

  const firstDow = new Date(days[0] + "T00:00:00").getDay(); // 0 = Sunday
  const padded = new Array(firstDow).fill(null).concat(days);

  const pagesByDay = {};
  state.sessions.forEach((s) => {
    pagesByDay[s.date] = (pagesByDay[s.date] || 0) + s.pages;
  });

  function levelFor(pages) {
    if (!pages) return 0;
    if (pages < 10) return 1;
    if (pages < 30) return 2;
    return 3;
  }

  const cellsHtml = padded
    .map((d) => {
      if (!d) return `<div class="heatmap-cell"></div>`;
      const pages = pagesByDay[d] || 0;
      const level = levelFor(pages);
      const title = `${formatNiceDate(d)}: ${pages} page${pages === 1 ? "" : "s"}`;
      return `<div class="heatmap-cell ${level ? "level-" + level : ""}" title="${escapeHtml(title)}"></div>`;
    })
    .join("");

  container.innerHTML = `<div class="heatmap-grid">${cellsHtml}</div>`;
}

function renderInsights() {
  renderMonthlyReview();
  renderCalendarHeatmap();
  renderPaceChart();
  renderEstimates();
}

// ---------- Discover tab ----------
const GENRES = [
  { label: "Fiction", slug: "fiction" },
  { label: "Fantasy", slug: "fantasy" },
  { label: "Mystery", slug: "mystery" },
  { label: "Thriller", slug: "thriller" },
  { label: "Romance", slug: "romance" },
  { label: "Science Fiction", slug: "science_fiction" },
  { label: "Horror", slug: "horror" },
  { label: "Biography & Memoir", slug: "biography" },
  { label: "History", slug: "history" },
  { label: "Self-Help", slug: "self-help" },
  { label: "Poetry", slug: "poetry" },
  { label: "Young Adult", slug: "young_adult_fiction" },
];

const MOODS = [
  { label: "Cozy & Comforting", key: "cozy", keywords: ["cozy", "feel-good", "comfort", "family life"] },
  { label: "Adventurous", key: "adventurous", keywords: ["adventure", "quest", "action", "exploration"] },
  { label: "Thought-Provoking", key: "thoughtful", keywords: ["philosophy", "literary fiction", "classic literature", "sociology"] },
  { label: "Light & Fun", key: "fun", keywords: ["humor", "humorous fiction", "satire", "comedy"] },
  { label: "Dark & Intense", key: "dark", keywords: ["horror", "psychological fiction", "dark fantasy", "thriller", "suspense"] },
  { label: "Emotional", key: "emotional", keywords: ["love story", "grief", "family life", "drama"] },
  { label: "Relaxing / Easy Read", key: "relaxing", keywords: ["short stories", "cozy mystery", "light fiction"] },
];

function populateDiscoverSelects() {
  const genreSel = document.getElementById("discover-genre");
  genreSel.innerHTML = GENRES.map((g) => `<option value="${g.slug}">${g.label}</option>`).join("");
  const moodSel = document.getElementById("discover-mood");
  moodSel.innerHTML = MOODS.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
}

function scoreWorkForMood(work, moodKeywords) {
  let score = 0;
  const subjects = (work.subject || []).map((s) => s.toLowerCase());
  moodKeywords.forEach((kw) => {
    if (subjects.some((s) => s.includes(kw))) score += 3;
  });
  if (work.cover_id) score += 1;
  if (work.edition_count) score += Math.min(work.edition_count / 50, 2);
  return score;
}

document.getElementById("btn-discover").addEventListener("click", async () => {
  const genreSlug = document.getElementById("discover-genre").value;
  const moodKey = document.getElementById("discover-mood").value;
  const mood = MOODS.find((m) => m.key === moodKey);
  const statusEl = document.getElementById("discover-status");
  const resultsEl = document.getElementById("discover-results");

  statusEl.textContent = "Finding some options…";
  resultsEl.innerHTML = "";

  try {
    const res = await fetch(`https://openlibrary.org/subjects/${encodeURIComponent(genreSlug)}.json?limit=50`);
    if (!res.ok) throw new Error("Bad response: " + res.status);
    const data = await res.json();
    const works = data.works || [];

    const existingTitles = new Set(state.books.map((b) => b.title.toLowerCase().trim()));

    const scored = works
      .filter((w) => !existingTitles.has((w.title || "").toLowerCase().trim()))
      .map((w) => ({ w, score: scoreWorkForMood(w, mood.keywords) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.w);

    if (scored.length === 0) {
      statusEl.textContent = "No suggestions found for that combination — try a different genre.";
      return;
    }

    statusEl.textContent = `${scored.length} suggestions for a ${mood.label.toLowerCase()} mood:`;
    resultsEl.innerHTML = scored
      .map((w, i) => {
        const cover = w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : "";
        const author = w.authors && w.authors[0] ? w.authors[0].name : "Unknown author";
        return `
        <div class="book-card">
          <div class="book-card-top">
            ${coverImgOrPlaceholder(cover, w.title)}
            <div class="book-info">
              <div class="book-title">${escapeHtml(w.title)}</div>
              <div class="book-author">${escapeHtml(author)}${w.first_publish_year ? " · " + w.first_publish_year : ""}</div>
            </div>
          </div>
          <div class="book-actions">
            <button class="btn-small" data-add-discover="${i}">+ Want to Read</button>
          </div>
        </div>`;
      })
      .join("");

    resultsEl.querySelectorAll("[data-add-discover]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const w = scored[Number(btn.dataset.addDiscover)];
        state.books.push({
          id: uid(),
          title: w.title,
          author: w.authors && w.authors[0] ? w.authors[0].name : "",
          totalPages: null,
          cover: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : "",
          isbn: "",
          status: "to_read",
          dateAdded: todayISO(),
          dateFinished: null,
          rating: null,
          review: "",
          currentCycle: 1,
          pastReads: [],
        });
        saveState();
        renderAll();
        btn.textContent = "Added ✓";
        btn.disabled = true;
      });
    });
  } catch (err) {
    console.warn("Discover fetch failed", err);
    statusEl.textContent = "Couldn't reach the recommendation service — try again in a moment.";
  }
});

// ---------- Discover: because you loved... ----------
function topRatedAuthors(minRating, limit) {
  minRating = minRating || 4;
  limit = limit || 3;
  const counts = {};
  state.books.forEach((b) => {
    if (b.author && b.rating >= minRating) counts[b.author] = (counts[b.author] || 0) + b.rating;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([author]) => author);
}

document.getElementById("btn-loved").addEventListener("click", async () => {
  const statusEl = document.getElementById("loved-status");
  const resultsEl = document.getElementById("loved-results");
  const authors = topRatedAuthors(4, 3);

  if (authors.length === 0) {
    statusEl.textContent = "Rate a few books 4-5★ first, then come back here.";
    resultsEl.innerHTML = "";
    return;
  }

  statusEl.textContent = `Looking for more from ${authors.join(", ")}…`;
  resultsEl.innerHTML = "";

  try {
    const existingTitles = new Set(state.books.map((b) => b.title.toLowerCase().trim()));
    const perAuthor = await Promise.all(authors.map((a) => fetchByTitleOrAuthor(a, "author").catch(() => [])));

    const seen = new Set();
    const combined = [];
    perAuthor.forEach((items, idx) => {
      items.forEach((it) => {
        const key = it.title.toLowerCase().trim();
        if (existingTitles.has(key) || seen.has(key)) return;
        seen.add(key);
        combined.push({ ...it, matchedAuthor: authors[idx] });
      });
    });
    const deduped = combined.slice(0, 8);

    if (deduped.length === 0) {
      statusEl.textContent = "Couldn't find anything new from those authors — try rating a few more books.";
      return;
    }

    statusEl.textContent = `Because you loved books by ${authors.join(", ")}:`;
    resultsEl.innerHTML = deduped
      .map(
        (d, i) => `
      <div class="book-card">
        <div class="book-card-top">
          ${coverImgOrPlaceholder(d.cover, d.title)}
          <div class="book-info">
            <div class="book-title">${escapeHtml(d.title)}</div>
            <div class="book-author">${escapeHtml(d.author || d.matchedAuthor)}${d.year ? " · " + d.year : ""}</div>
          </div>
        </div>
        <div class="book-actions">
          <button class="btn-small" data-add-loved="${i}">+ Want to Read</button>
        </div>
      </div>`
      )
      .join("");

    resultsEl.querySelectorAll("[data-add-loved]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = deduped[Number(btn.dataset.addLoved)];
        state.books.push({
          id: uid(),
          title: d.title,
          author: d.author || d.matchedAuthor,
          totalPages: d.totalPages || null,
          cover: d.cover || "",
          isbn: "",
          status: "to_read",
          dateAdded: todayISO(),
          dateFinished: null,
          rating: null,
          review: "",
          currentCycle: 1,
          pastReads: [],
        });
        saveState();
        renderAll();
        btn.textContent = "Added ✓";
        btn.disabled = true;
      });
    });
  } catch (err) {
    console.warn("Loved-recs fetch failed", err);
    statusEl.textContent = "Couldn't reach the recommendation service — try again in a moment.";
  }
});

// ---------- Init ----------
document.getElementById("review-month").value = todayISO().slice(0, 7);
populateDiscoverSelects();
renderAll();
