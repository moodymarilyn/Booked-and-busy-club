/* Book Club Picker — shared app logic for index.html and archive.html */
"use strict";

const sb = window.supabase.createClient(
  window.BCP_CONFIG.SUPABASE_URL,
  window.BCP_CONFIG.SUPABASE_ANON_KEY
);

const PAGE = document.body.dataset.page; // "main" | "archive"
const $ = (sel) => document.querySelector(sel);

const state = {
  user: null,
  books: [],          // rows from `books` (added_by never queried)
  stats: {},          // book_id -> {upvotes, downvotes, read_count}
  myVotes: {},        // book_id -> 1 | -1
  myReads: new Set(), // book_ids I've read
  memberCount: 0,
  candidateId: null,  // current lottery candidate
};

/* ---------- tiny helpers ---------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function show(id, on = true) {
  const node = document.getElementById(id);
  if (node) node.classList.toggle("hidden", !on);
}

function scoreOf(book) {
  const s = state.stats[book.id] || { upvotes: 0, downvotes: 0, read_count: 0 };
  return s.upvotes - s.downvotes - s.read_count;
}

function searchUrl(book, site) {
  const q = encodeURIComponent(`${book.title} ${book.author || ""}`.trim());
  return site === "goodreads"
    ? `https://www.goodreads.com/search?q=${q}`
    : `https://app.thestorygraph.com/browse?search_term=${q}`;
}

/* ---------- auth ---------- */

let booting = false;

async function boot() {
  if (booting) return;
  booting = true;
  const { data: { session } } = await sb.auth.getSession();
  show("loading", false);
  if (!session) {
    booting = false; // allow re-boot when the magic link signs us in
    return showLogin();
  }

  const { data: isMember, error } = await sb.rpc("is_member");
  if (error || !isMember) {
    $("#nm-email").textContent = session.user.email;
    show("login", false);
    show("not-member");
    show("signout-btn");
    return;
  }
  state.user = session.user;
  show("login", false);
  show("not-member", false);
  show("signout-btn");
  show("app");
  await refresh();
}

let loginWired = false;

function showLogin() {
  show("login");
  if (loginWired) return;
  loginWired = true;
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    $("#login-msg").textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    $("#login-msg").textContent = error
      ? `Error: ${error.message}`
      : "Check your email for the magic link ✉️";
  });
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

/* ---------- data ---------- */

const BOOK_COLS =
  "id, ol_work_id, title, author, cover_url, subjects, blurb, status, created_at, finished_at";

async function refresh() {
  const [books, stats, votes, reads, count] = await Promise.all([
    sb.from("books").select(BOOK_COLS),
    sb.from("book_stats").select("*"),
    sb.from("votes").select("book_id, value"),
    sb.from("reads").select("book_id"),
    sb.rpc("member_count"),
  ]);

  const err = books.error || stats.error || votes.error || reads.error || count.error;
  if (err) {
    console.error(err);
    alert("Couldn't load data: " + err.message);
    return;
  }

  state.books = books.data;
  state.stats = Object.fromEntries(stats.data.map((s) => [s.book_id, s]));
  state.myVotes = Object.fromEntries(votes.data.map((v) => [v.book_id, v.value]));
  state.myReads = new Set(reads.data.map((r) => r.book_id));
  state.memberCount = count.data || 0;

  if (PAGE === "archive") renderArchive();
  else renderMain();
}

/* ---------- rendering ---------- */

function readBadge(book) {
  const n = (state.stats[book.id] || {}).read_count || 0;
  return `<span class="badge read-badge">${n} of ${state.memberCount} have read this</span>`;
}

function coverImg(book) {
  return book.cover_url
    ? `<img class="cover" src="${esc(book.cover_url)}" alt="" loading="lazy">`
    : `<div class="cover placeholder">📕</div>`;
}

function bookCard(book, { actions = true } = {}) {
  const score = scoreOf(book);
  const myVote = state.myVotes[book.id] || 0;
  const iRead = state.myReads.has(book.id);

  const voteRow = actions && book.status === "pool" ? `
    <div class="vote-row">
      <button class="vote-btn ${myVote === 1 ? "active-up" : ""}" data-vote="1" data-book="${book.id}" title="Upvote">▲</button>
      <span class="score" title="upvotes − downvotes − reads">${score}</span>
      <button class="vote-btn ${myVote === -1 ? "active-down" : ""}" data-vote="-1" data-book="${book.id}" title="Downvote">▼</button>
      <button class="read-btn ${iRead ? "active" : ""}" data-read="${book.id}">
        ${iRead ? "✓ I've read this" : "I've read this"}
      </button>
    </div>` : "";

  const finishedNote = book.status === "finished" && book.finished_at
    ? `<span class="badge">Finished ${new Date(book.finished_at).toLocaleDateString()}</span>` : "";

  return `
  <div class="book-card" id="book-${book.id}">
    ${coverImg(book)}
    <div class="book-info">
      <h3>${esc(book.title)}</h3>
      <p class="author">${esc(book.author || "Unknown author")}</p>
      ${book.blurb ? `<p class="blurb">“${esc(book.blurb)}”</p>` : ""}
      <div class="badges">${readBadge(book)} ${finishedNote}</div>
      <div class="links">
        <a href="${searchUrl(book, "goodreads")}" target="_blank" rel="noopener">Goodreads</a> ·
        <a href="${searchUrl(book, "storygraph")}" target="_blank" rel="noopener">StoryGraph</a>
      </div>
      ${voteRow}
    </div>
  </div>`;
}

function renderMain() {
  // Current read
  const current = state.books.find((b) => b.status === "current");
  show("current-read", !!current);
  if (current) {
    $("#current-card").innerHTML =
      bookCard(current, { actions: false }) +
      `<button id="finish-btn" class="btn">✅ We finished it!</button>`;
    $("#finish-btn").addEventListener("click", () => markFinished(current.id));
  }

  // Lottery button only when there's no current read
  $("#choose-btn").disabled = !!current;
  $("#lottery-msg").textContent = current
    ? "Finish the current read to unlock the lottery." : "";
  if (current) { show("candidate", false); state.candidateId = null; }

  // Pool
  const pool = state.books
    .filter((b) => b.status === "pool")
    .sort((a, b) => scoreOf(b) - scoreOf(a) || a.created_at.localeCompare(b.created_at));
  $("#pool-list").innerHTML = pool.map((b) => bookCard(b)).join("");
  show("pool-empty", pool.length === 0);

  // Wire vote / read buttons
  document.querySelectorAll("[data-vote]").forEach((btn) =>
    btn.addEventListener("click", () => vote(btn.dataset.book, Number(btn.dataset.vote))));
  document.querySelectorAll("[data-read]").forEach((btn) =>
    btn.addEventListener("click", () => toggleRead(btn.dataset.read)));
}

function renderArchive() {
  const done = state.books
    .filter((b) => b.status === "finished")
    .sort((a, b) => (b.finished_at || "").localeCompare(a.finished_at || ""));
  $("#archive-list").innerHTML = done.map((b) => bookCard(b, { actions: false })).join("");
  show("archive-empty", done.length === 0);
}

/* ---------- votes & reads ---------- */

async function vote(bookId, value) {
  const current = state.myVotes[bookId] || 0;
  const { error } = current === value
    ? await sb.from("votes").delete().match({ user_id: state.user.id, book_id: bookId })
    : await sb.from("votes").upsert(
        { user_id: state.user.id, book_id: bookId, value },
        { onConflict: "user_id,book_id" });
  if (error) return alert("Vote failed: " + error.message);
  await refresh();
}

async function toggleRead(bookId) {
  const { error } = state.myReads.has(bookId)
    ? await sb.from("reads").delete().match({ user_id: state.user.id, book_id: bookId })
    : await sb.from("reads").insert({ user_id: state.user.id, book_id: bookId });
  if (error) return alert("Couldn't update: " + error.message);
  await refresh();
}

/* ---------- weighted lottery ---------- */

function pickWeighted(pool) {
  // weight = score if positive, else floor of 1 (spec §3.5)
  const weights = pool.map((b) => Math.max(scoreOf(b), 1));
  const total = weights.reduce((a, w) => a + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function spin() {
  const pool = state.books.filter((b) => b.status === "pool");
  if (pool.length === 0) {
    $("#lottery-msg").textContent = "The pool is empty — add some books first!";
    return;
  }
  const pick = pickWeighted(pool);
  state.candidateId = pick.id;
  $("#candidate-card").innerHTML = bookCard(pick, { actions: false });
  show("candidate");
}

async function acceptCandidate() {
  if (!state.candidateId) return;
  // .eq("status","pool") + the unique index guard against races.
  const { data, error } = await sb.from("books")
    .update({ status: "current" })
    .eq("id", state.candidateId)
    .eq("status", "pool")
    .select("id");
  if (error || !data || data.length === 0) {
    alert("Couldn't set the current read — someone may have beaten you to it.");
  }
  state.candidateId = null;
  show("candidate", false);
  await refresh();
}

async function markFinished(bookId) {
  if (!confirm("Mark the current read as finished and move it to the archive?")) return;
  const { error } = await sb.from("books")
    .update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("id", bookId);
  if (error) return alert("Couldn't mark finished: " + error.message);
  await refresh();
}

/* ---------- add a recommendation (Open Library) ---------- */

let searchTimer = null;
let selectedResult = null;

function initSearch() {
  const input = $("#search-input");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 3) { show("search-results", false); return; }
    searchTimer = setTimeout(() => searchOpenLibrary(q), 350);
  });
}

async function searchOpenLibrary(q) {
  const url = "https://openlibrary.org/search.json?limit=8" +
    "&fields=key,title,author_name,cover_i,first_publish_year,subject" +
    "&q=" + encodeURIComponent(q);
  let json;
  try {
    const res = await fetch(url);
    json = await res.json();
  } catch {
    $("#add-msg").textContent = "Open Library search failed — try again.";
    return;
  }
  const list = $("#search-results");
  list.innerHTML = (json.docs || []).map((d, i) => `
    <li data-i="${i}">
      ${d.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" alt="">` : "<span class='mini-cover'>📕</span>"}
      <span>${esc(d.title)} — ${esc((d.author_name || []).join(", ") || "Unknown")}
        ${d.first_publish_year ? `(${d.first_publish_year})` : ""}</span>
    </li>`).join("");
  show("search-results", list.children.length > 0);
  list.querySelectorAll("li").forEach((li) =>
    li.addEventListener("click", () => selectResult(json.docs[Number(li.dataset.i)])));
}

function selectResult(doc) {
  show("search-results", false);
  const workId = doc.key.replace("/works/", "");

  // Duplicates impossible: if it's already in the pool, offer to upvote instead.
  const existing = state.books.find((b) => b.ol_work_id === workId);
  if (existing) {
    show("add-form", false);
    $("#add-msg").innerHTML =
      `<strong>${esc(existing.title)}</strong> is already ${existing.status === "pool" ? "in the pool" : `marked “${esc(existing.status)}”`}. ` +
      (existing.status === "pool"
        ? `<button class="btn small primary" id="upvote-existing">▲ Upvote it instead</button>` : "");
    const btn = $("#upvote-existing");
    if (btn) btn.addEventListener("click", async () => {
      if ((state.myVotes[existing.id] || 0) !== 1) await vote(existing.id, 1);
      $("#add-msg").textContent = "Upvoted!";
      document.getElementById(`book-${existing.id}`)?.scrollIntoView({ behavior: "smooth" });
    });
    return;
  }

  selectedResult = {
    ol_work_id: workId,
    title: doc.title,
    author: (doc.author_name || []).join(", ") || null,
    cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    subjects: (doc.subject || []).slice(0, 6),
  };
  $("#add-msg").textContent = "";
  $("#add-preview").innerHTML = `
    ${selectedResult.cover_url ? `<img class="cover" src="${esc(selectedResult.cover_url)}" alt="">` : ""}
    <strong>${esc(selectedResult.title)}</strong> — ${esc(selectedResult.author || "Unknown")}`;
  $("#add-blurb").value = "";
  show("add-form");
}

async function confirmAdd() {
  if (!selectedResult) return;
  const blurb = $("#add-blurb").value.trim() || null;
  const { error } = await sb.from("books").insert({ ...selectedResult, blurb });
  if (error) {
    $("#add-msg").textContent = error.code === "23505"
      ? "Someone added that book just now — it's already in the pool!"
      : "Couldn't add: " + error.message;
  } else {
    $("#add-msg").textContent = `Added “${selectedResult.title}” to the pool 🎉`;
  }
  selectedResult = null;
  show("add-form", false);
  $("#search-input").value = "";
  await refresh();
}

/* ---------- wire up ---------- */

document.getElementById("signout-btn").addEventListener("click", signOut);
document.getElementById("nm-signout")?.addEventListener("click", signOut);

if (PAGE === "main") {
  $("#choose-btn").addEventListener("click", spin);
  $("#spin-btn").addEventListener("click", spin);
  $("#accept-btn").addEventListener("click", acceptCandidate);
  $("#cancel-spin-btn").addEventListener("click", () => {
    state.candidateId = null;
    show("candidate", false);
  });
  $("#add-confirm-btn").addEventListener("click", confirmAdd);
  $("#add-cancel-btn").addEventListener("click", () => {
    selectedResult = null;
    show("add-form", false);
  });
  initSearch();
}

// Re-boot when the magic link lands us back with a fresh session.
sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" && !state.user) boot();
});

boot();
