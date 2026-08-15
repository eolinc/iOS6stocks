/* =========================================================================
   Borsa — app.js
   Logica applicativa: gestione watchlist, fetch quotazioni/storico tramite
   backend proxy (con fallback locale se il backend non è raggiungibile),
   rendering della lista, disegno del grafico su <canvas>, flip-card per
   l'editing dei titoli. Nessuna chiave API è mai presente in questo file:
   tutte le chiamate a provider esterni passano dal backend (vedi /server).
   ========================================================================= */

(() => {
  "use strict";

  /* ----------------------------------------------------------------- */
  /* Configurazione                                                     */
  /* ----------------------------------------------------------------- */
  const API_BASE = window.BORSA_API_BASE || ""; // impostato in js/config.js — vedi quel file per GitHub Pages
  const STORAGE_KEY = "borsa.watchlist.v1";
  const MODE_KEY = "borsa.displaymode.v1";

  const DEFAULT_WATCHLIST = [
    { symbol: "^DJI",  name: "Dow Jones" },
    { symbol: "^FTSE", name: "FTSE 100" },
    { symbol: "^HSI",  name: "Hang Seng" },
    { symbol: "^N225", name: "Nikkei 225" },
    { symbol: "^AORD", name: "All Ordinaries" },
    { symbol: "^STI",  name: "Straits Times" }
  ];

  // Directory statica minima per la ricerca offline (fallback se /api/search
  // non è raggiungibile). Il backend reale può interrogare qualunque provider.
  const LOCAL_DIRECTORY = [
    { symbol: "AAPL", name: "Apple Inc." },
    { symbol: "GOOGL", name: "Alphabet Inc." },
    { symbol: "MSFT", name: "Microsoft Corp." },
    { symbol: "AMZN", name: "Amazon.com Inc." },
    { symbol: "TSLA", name: "Tesla Inc." },
    { symbol: "^DJI", name: "Dow Jones" },
    { symbol: "^GSPC", name: "S&P 500" },
    { symbol: "^IXIC", name: "NASDAQ Composite" },
    { symbol: "^FTSE", name: "FTSE 100" },
    { symbol: "^HSI", name: "Hang Seng" },
    { symbol: "^N225", name: "Nikkei 225" },
    { symbol: "^GDAXI", name: "DAX" }
  ];

  const RANGE_LABELS = { "1d":"1g","1w":"1s","1m":"1m","3m":"3m","6m":"6m","1y":"1a","2y":"2a" };

  /* ----------------------------------------------------------------- */
  /* Stato                                                              */
  /* ----------------------------------------------------------------- */
  const state = {
    watchlist: loadWatchlist(),
    quotes: {},          // symbol -> {price, change, changePct, name, currency}
    activeSymbol: null,
    activeRange: "1w",
    displayMode: localStorage.getItem(MODE_KEY) || "price",
    history: {},          // cache: `${symbol}:${range}` -> points[]
    editing: false
  };

  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignora e usa i default */ }
    return DEFAULT_WATCHLIST.slice();
  }
  function saveWatchlist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.watchlist));
  }

  /* ----------------------------------------------------------------- */
  /* Elementi DOM                                                       */
  /* ----------------------------------------------------------------- */
  const el = {
    quotesList: document.getElementById("quotesList"),
    chartCard: document.getElementById("chartCard"),
    chartCanvas: document.getElementById("chartCanvas"),
    chartMessage: document.getElementById("chartMessage"),
    chartSymbolLabel: document.getElementById("chartSymbolLabel"),
    rangeControl: document.getElementById("rangeControl"),
    infoBtn: document.getElementById("infoBtn"),
    addBtn: document.getElementById("addBtn"),
    editList: document.getElementById("editList"),
    addSymbolInput: document.getElementById("addSymbolInput"),
    addSymbolBtn: document.getElementById("addSymbolBtn"),
    searchResults: document.getElementById("searchResults"),
    displayModeControl: document.getElementById("displayModeControl"),
    footerText: document.getElementById("footerText")
  };
  const ctx = el.chartCanvas.getContext("2d");

  /* ----------------------------------------------------------------- */
  /* Data layer — providers astratti dietro al backend                  */
  /* ----------------------------------------------------------------- */
  async function fetchQuotes(symbols) {
    const url = `${API_BASE}/api/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      return data; // { SYMBOL: {price,change,changePct,name,currency}, ... }
    } catch (e) {
      return mockQuotes(symbols); // degrado controllato, mai dati inventati come "reali"
    }
  }

  async function fetchHistory(symbol, range) {
    const cacheKey = `${symbol}:${range}`;
    if (state.history[cacheKey]) return state.history[cacheKey];
    const url = `${API_BASE}/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      if (!data || !data.points || !data.points.length) throw new Error("empty");
      state.history[cacheKey] = data.points;
      return data.points;
    } catch (e) {
      const mock = mockHistory(symbol, range);
      if (mock) state.history[cacheKey] = mock;
      return mock;
    }
  }

  async function searchSymbols(query) {
    const url = `${API_BASE}/api/search?q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
      throw new Error("empty");
    } catch (e) {
      const q = query.trim().toUpperCase();
      if (!q) return [];
      return LOCAL_DIRECTORY.filter(d =>
        d.symbol.toUpperCase().includes(q) || d.name.toUpperCase().includes(q)
      ).slice(0, 8);
    }
  }

  /* ----- Fallback dimostrativo, usato SOLO se il backend non risponde ---- */
  function seededRandom(seed) {
    let s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  function hashSymbol(sym) {
    let h = 0; for (let i=0;i<sym.length;i++) h = (h*31 + sym.charCodeAt(i)) | 0;
    return Math.abs(h) || 1;
  }
  function mockQuotes(symbols) {
    const out = {};
    symbols.forEach(sym => {
      const rnd = seededRandom(hashSymbol(sym) + Math.floor(Date.now()/60000));
      const base = 50 + (hashSymbol(sym) % 900) + rnd()*10;
      const changePct = (rnd() - 0.5) * 4;
      const change = base * (changePct/100);
      const dir = LOCAL_DIRECTORY.find(d => d.symbol === sym);
      out[sym] = {
        price: base,
        change: change,
        changePct: changePct,
        name: (dir && dir.name) || sym.replace(/^\^/, ""),
        currency: "USD",
        offline: true
      };
    });
    return out;
  }
  function mockHistory(symbol, range) {
    const pointsCount = { "1d":48, "1w":42, "1m":30, "3m":36, "6m":26, "1y":52, "2y":52 }[range] || 30;
    const rnd = seededRandom(hashSymbol(symbol + range));
    let v = 50 + (hashSymbol(symbol) % 900);
    const pts = [];
    for (let i=0;i<pointsCount;i++) {
      v += (rnd()-0.5) * (v*0.012);
      v = Math.max(1, v);
      pts.push({ t: i, v: v });
    }
    return pts;
  }

  /* ----------------------------------------------------------------- */
  /* Rendering — lista quotazioni                                       */
  /* ----------------------------------------------------------------- */
  function formatPrice(v) {
    if (v == null || isNaN(v)) return "—";
    return v >= 1000 ? v.toLocaleString("it-IT", {maximumFractionDigits: 2}) : v.toFixed(2);
  }
  function formatChange(v) {
    if (v == null || isNaN(v)) return "—";
    const sign = v > 0 ? "+" : v < 0 ? "\u2212" : "";
    return sign + Math.abs(v).toFixed(2);
  }
  function formatPct(v) {
    if (v == null || isNaN(v)) return "—";
    const sign = v > 0 ? "+" : v < 0 ? "\u2212" : "";
    return sign + Math.abs(v).toFixed(2) + "%";
  }

  function renderList() {
    el.quotesList.innerHTML = "";
    state.watchlist.forEach(item => {
      const q = state.quotes[item.symbol];
      const li = document.createElement("li");
      li.className = "quote-row" + (item.symbol === state.activeSymbol ? " selected" : "");
      li.dataset.symbol = item.symbol;

      const dirClass = !q ? "loading" : q.changePct > 0.0001 ? "up" : q.changePct < -0.0001 ? "down" : "flat";

      let rightValue;
      if (state.displayMode === "percent") rightValue = q ? formatPct(q.changePct) : "";
      else if (state.displayMode === "marketcap") rightValue = q && q.marketCap ? q.marketCap : "N/D";
      else rightValue = q ? formatChange(q.change) : "";

      li.innerHTML = `
        <div class="q-left">
          <span class="q-symbol">${item.symbol.replace(/^\^/, "")}</span>
          <span class="q-name">${(q && q.name) || item.name || ""}</span>
        </div>
        <div class="q-right">
          <span class="q-price">${q ? formatPrice(q.price) : ""}</span>
          <span class="q-change ${dirClass}">${rightValue}</span>
        </div>`;
      li.addEventListener("click", () => selectSymbol(item.symbol));
      el.quotesList.appendChild(li);
    });
  }

  function renderEditList() {
    el.editList.innerHTML = "";
    state.watchlist.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "edit-row";
      li.innerHTML = `
        <button class="remove-btn" data-idx="${idx}" aria-label="Rimuovi">&minus;</button>
        <span class="edit-row-label">${item.symbol.replace(/^\^/, "")}
          <span class="edit-row-name">${item.name || ""}</span>
        </span>
        <span class="drag-handle">&#9776;</span>`;
      li.querySelector(".remove-btn").addEventListener("click", () => {
        state.watchlist.splice(idx, 1);
        saveWatchlist();
        if (state.activeSymbol && !state.watchlist.find(w => w.symbol === state.activeSymbol)) {
          state.activeSymbol = state.watchlist[0] ? state.watchlist[0].symbol : null;
        }
        renderEditList();
        renderList();
        refreshQuotes();
      });
      el.editList.appendChild(li);
    });
  }

  /* ----------------------------------------------------------------- */
  /* Selezione titolo + grafico                                         */
  /* ----------------------------------------------------------------- */
  async function selectSymbol(symbol) {
    state.activeSymbol = symbol;
    renderList();
    await loadAndDrawChart();
  }

  async function loadAndDrawChart() {
    if (!state.activeSymbol) {
      el.chartMessage.textContent = "Aggiungi un titolo per iniziare";
      clearCanvas();
      return;
    }
    el.chartSymbolLabel.textContent = state.activeSymbol.replace(/^\^/, "");
    el.chartMessage.textContent = "";
    clearCanvas();
    const points = await fetchHistory(state.activeSymbol, state.activeRange);
    if (!points || !points.length) {
      el.chartMessage.textContent = "Errore recupero grafico";
      return;
    }
    drawChart(points);
  }

  function clearCanvas() {
    const { width, height } = resizeCanvasToDisplaySize();
    ctx.clearRect(0, 0, width, height);
  }

  function resizeCanvasToDisplaySize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = el.chartCanvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (el.chartCanvas.width !== width*dpr || el.chartCanvas.height !== height*dpr) {
      el.chartCanvas.width = width * dpr;
      el.chartCanvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { width, height };
  }

  function drawChart(points) {
    const { width, height } = resizeCanvasToDisplaySize();
    ctx.clearRect(0, 0, width, height);

    const padL = 6, padR = 40, padT = 10, padB = 16;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const values = points.map(p => p.v);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const yFor = v => padT + plotH - ((v - min) / span) * plotH;
    const xFor = i => padL + (i / (points.length - 1)) * plotW;

    // --- griglia orizzontale sottile ---
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let g = 0; g <= gridLines; g++) {
      const y = padT + (plotH / gridLines) * g;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(y) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // --- pattern tratteggio diagonale sotto la linea (iconico iOS6) ---
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = 6; patternCanvas.height = 6;
    const pctx = patternCanvas.getContext("2d");
    pctx.strokeStyle = "rgba(255,255,255,0.16)";
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(0, 6); pctx.lineTo(6, 0);
    pctx.stroke();
    const pattern = ctx.createPattern(patternCanvas, "repeat");

    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(values[0]));
    values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
    ctx.lineTo(xFor(values.length - 1), padT + plotH);
    ctx.lineTo(xFor(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = pattern;
    ctx.fill();

    // --- linea del prezzo ---
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(values[0]));
    values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // --- etichette asse Y (a destra) ---
    ctx.fillStyle = "#c3cee6";
    ctx.font = "10px -apple-system, Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let g = 0; g <= gridLines; g++) {
      const val = max - (span / gridLines) * g;
      const y = padT + (plotH / gridLines) * g;
      ctx.fillText(formatPrice(val), padL + plotW + 6, y);
    }
  }

  /* ----------------------------------------------------------------- */
  /* Refresh dati                                                        */
  /* ----------------------------------------------------------------- */
  async function refreshQuotes() {
    if (!state.watchlist.length) { renderList(); return; }
    const symbols = state.watchlist.map(w => w.symbol);
    const data = await fetchQuotes(symbols);
    state.quotes = data;
    let anyOffline = false;
    Object.values(data).forEach(q => { if (q.offline) anyOffline = true; });
    el.footerText.textContent = anyOffline
      ? "Modalità dimostrativa — nessuna connessione al provider"
      : "Quotazioni ritardate di 20 minuti";
    if (!state.activeSymbol && state.watchlist[0]) state.activeSymbol = state.watchlist[0].symbol;
    renderList();
    if (state.activeSymbol) loadAndDrawChart();
  }

  /* ----------------------------------------------------------------- */
  /* Eventi UI                                                           */
  /* ----------------------------------------------------------------- */
  el.rangeControl.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    el.rangeControl.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.activeRange = btn.dataset.range;
    loadAndDrawChart();
  });

  function toggleFlip(show) {
    state.editing = show === undefined ? !state.editing : show;
    el.chartCard.classList.toggle("flipped", state.editing);
    if (state.editing) renderEditList();
  }
  el.infoBtn.addEventListener("click", () => toggleFlip());

  let searchTimer = null;
  el.addSymbolInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = el.addSymbolInput.value.trim();
    if (!q) { el.searchResults.classList.remove("open"); el.searchResults.innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      const results = await searchSymbols(q);
      el.searchResults.innerHTML = "";
      results.forEach(r => {
        const row = document.createElement("div");
        row.className = "search-result-row";
        row.innerHTML = `<span><b>${r.symbol.replace(/^\^/, "")}</b>${r.name || ""}</span><span>+</span>`;
        row.addEventListener("click", () => addSymbol(r.symbol, r.name));
        el.searchResults.appendChild(row);
      });
      el.searchResults.classList.toggle("open", results.length > 0);
    }, 250);
  });

  function addSymbol(rawSymbol, name) {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) return;
    if (state.watchlist.find(w => w.symbol === symbol)) return;
    state.watchlist.push({ symbol, name: name || "" });
    saveWatchlist();
    el.addSymbolInput.value = "";
    el.searchResults.classList.remove("open");
    el.searchResults.innerHTML = "";
    renderEditList();
    renderList();
    refreshQuotes();
  }
  el.addSymbolBtn.addEventListener("click", () => addSymbol(el.addSymbolInput.value));
  el.addSymbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addSymbol(el.addSymbolInput.value);
  });

  el.displayModeControl.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    el.displayModeControl.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.displayMode = btn.dataset.mode;
    localStorage.setItem(MODE_KEY, state.displayMode);
    renderList();
  });

  window.addEventListener("resize", () => { if (state.activeSymbol) loadAndDrawChart(); });

  /* ----------------------------------------------------------------- */
  /* Avvio                                                               */
  /* ----------------------------------------------------------------- */
  async function init() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    renderList();
    await refreshQuotes();
    setInterval(refreshQuotes, 60000); // aggiornamento periodico, come l'app originale
  }
  init();
})();
