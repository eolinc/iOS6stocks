/* =========================================================================
   Borsa — app.js
   Logica applicativa: gestione di più "pagine" di titoli (come le pagine
   swipeabili del widget originale, indicate dai puntini in basso), fetch
   quotazioni/storico tramite backend proxy (con fallback locale se il
   backend non è raggiungibile), rendering, disegno del grafico su
   <canvas>, flip-card per l'editing/riordino dei titoli. Nessuna chiave
   API è mai presente in questo file: tutte le chiamate ai provider esterni
   passano dal backend (vedi /server).
   ========================================================================= */

(() => {
  "use strict";

  /* ----------------------------------------------------------------- */
  /* Configurazione                                                     */
  /* ----------------------------------------------------------------- */
  const API_BASE = window.BORSA_API_BASE || ""; // impostato in js/config.js — vedi quel file per GitHub Pages
  const PAGES_KEY = "borsa.pages.v1";
  const LEGACY_WATCHLIST_KEY = "borsa.watchlist.v1"; // formato usato prima delle pagine multiple
  const MODE_KEY = "borsa.displaymode.v1";

  const DEFAULT_INDICES = [
    { symbol: "^DJI",  name: "Dow Jones" },
    { symbol: "^FTSE", name: "FTSE 100" },
    { symbol: "^HSI",  name: "Hang Seng" },
    { symbol: "^N225", name: "Nikkei 225" },
    { symbol: "^AORD", name: "All Ordinaries" },
    { symbol: "^STI",  name: "Straits Times" }
  ];
  const DEFAULT_STOCKS = [
    { symbol: "AAPL", name: "Apple Inc." },
    { symbol: "GOOGL", name: "Alphabet Inc." }
  ];
  const DEFAULT_PAGES = [
    { id: "p1", title: "Titoli",  symbols: DEFAULT_INDICES.slice() },
    { id: "p2", title: "Azioni",  symbols: DEFAULT_STOCKS.slice() }
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

  /* ----------------------------------------------------------------- */
  /* Stato + persistenza pagine                                         */
  /* ----------------------------------------------------------------- */
  function loadPages() {
    try {
      const raw = localStorage.getItem(PAGES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (e) { /* ignora e prova la migrazione */ }

    // Migrazione dal vecchio formato a lista unica (versione precedente
    // dell'app, prima delle pagine multiple): la lista già personalizzata
    // dall'utente diventa la prima pagina; la seconda pagina resta quella
    // di default, così non si perde nulla di ciò che era stato aggiunto.
    try {
      const legacyRaw = localStorage.getItem(LEGACY_WATCHLIST_KEY);
      if (legacyRaw) {
        const legacyList = JSON.parse(legacyRaw);
        if (Array.isArray(legacyList) && legacyList.length) {
          return [
            { id: "p1", title: "Titoli", symbols: legacyList },
            { id: "p2", title: "Indici", symbols: DEFAULT_INDICES.slice() }
          ];
        }
      }
    } catch (e) { /* ignora e usa i default */ }

    return DEFAULT_PAGES.map(p => ({ id: p.id, title: p.title, symbols: p.symbols.slice() }));
  }
  function savePages() {
    localStorage.setItem(PAGES_KEY, JSON.stringify(state.pages));
  }

  const state = {
    pages: loadPages(),
    currentPageIndex: 0,
    quotes: {},          // symbol -> {price, change, changePct, name, currency}
    activeSymbol: null,
    activeRange: "1w",
    displayMode: localStorage.getItem(MODE_KEY) || "price",
    history: {},          // cache: `${symbol}:${range}` -> points[]
    editing: false
  };

  function currentPage() { return state.pages[state.currentPageIndex]; }
  function currentSymbols() { return currentPage().symbols; }
  function allSymbols() {
    const seen = new Set();
    const out = [];
    state.pages.forEach(p => p.symbols.forEach(s => {
      if (!seen.has(s.symbol)) { seen.add(s.symbol); out.push(s.symbol); }
    }));
    return out;
  }

  /* ----------------------------------------------------------------- */
  /* Elementi DOM                                                       */
  /* ----------------------------------------------------------------- */
  const el = {
    quotesCard: document.getElementById("quotesCard"),
    quotesList: document.getElementById("quotesList"),
    pageDots: document.getElementById("pageDots"),
    chartCard: document.getElementById("chartCard"),
    chartCanvas: document.getElementById("chartCanvas"),
    chartMessage: document.getElementById("chartMessage"),
    chartSymbolLabel: document.getElementById("chartSymbolLabel"),
    rangeControl: document.getElementById("rangeControl"),
    infoBtn: document.getElementById("infoBtn"),
    backCloseBtn: document.getElementById("backCloseBtn"),
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
  /* Formattazione                                                       */
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

  /* ----------------------------------------------------------------- */
  /* Rendering — lista quotazioni (pagina corrente)                     */
  /* ----------------------------------------------------------------- */
  function renderList() {
    el.quotesList.innerHTML = "";
    currentSymbols().forEach(item => {
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

  /* ----------------------------------------------------------------- */
  /* Puntini di paginazione — un puntino per pagina, tap o swipe          */
  /* ----------------------------------------------------------------- */
  function renderPageDots() {
    el.pageDots.innerHTML = "";
    state.pages.forEach((p, i) => {
      const dot = document.createElement("span");
      dot.className = "dot" + (i === state.currentPageIndex ? " active" : "");
      dot.addEventListener("click", () => goToPage(i));
      el.pageDots.appendChild(dot);
    });
  }

  function goToPage(index) {
    const clamped = Math.max(0, Math.min(state.pages.length - 1, index));
    if (clamped === state.currentPageIndex) return;
    state.currentPageIndex = clamped;
    renderPageDots();
    renderList();
    const first = currentSymbols()[0];
    if (first) selectSymbol(first.symbol);
    else { state.activeSymbol = null; loadAndDrawChart(); }
  }

  // Swipe orizzontale sulla lista per cambiare pagina; lo scroll verticale
  // della lista continua a funzionare normalmente (touch-action: pan-y in CSS).
  (function setupSwipe() {
    let swipe = null;
    el.quotesList.addEventListener("pointerdown", (e) => {
      swipe = { startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, pointerId: e.pointerId, decided: false, horizontal: false };
    });
    el.quotesList.addEventListener("pointermove", (e) => {
      if (!swipe || e.pointerId !== swipe.pointerId) return;
      swipe.dx = e.clientX - swipe.startX;
      swipe.dy = e.clientY - swipe.startY;
      if (!swipe.decided && (Math.abs(swipe.dx) > 8 || Math.abs(swipe.dy) > 8)) {
        swipe.decided = true;
        swipe.horizontal = Math.abs(swipe.dx) > Math.abs(swipe.dy);
      }
    });
    function endSwipe(e) {
      if (!swipe || e.pointerId !== swipe.pointerId) { swipe = null; return; }
      if (swipe.horizontal && Math.abs(swipe.dx) > 40) {
        goToPage(state.currentPageIndex + (swipe.dx < 0 ? 1 : -1));
      }
      swipe = null;
    }
    el.quotesList.addEventListener("pointerup", endSwipe);
    el.quotesList.addEventListener("pointercancel", () => { swipe = null; });
  })();

  /* ----------------------------------------------------------------- */
  /* Editing / riordino titoli (facciata posteriore della card grafico)  */
  /* ----------------------------------------------------------------- */
  function renderEditList() {
    el.editList.innerHTML = "";
    currentSymbols().forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "edit-row";
      li.dataset.symbol = item.symbol;
      li.innerHTML = `
        <button class="remove-btn" aria-label="Rimuovi">&minus;</button>
        <span class="edit-row-label">${item.symbol.replace(/^\^/, "")}
          <span class="edit-row-name">${item.name || ""}</span>
        </span>
        <span class="drag-handle" aria-label="Trascina per riordinare">&#9776;</span>`;
      li.querySelector(".remove-btn").addEventListener("click", () => {
        const symbols = currentSymbols();
        symbols.splice(idx, 1);
        savePages();
        if (state.activeSymbol && !symbols.find(w => w.symbol === state.activeSymbol)) {
          state.activeSymbol = symbols[0] ? symbols[0].symbol : null;
        }
        renderEditList();
        renderList();
        refreshQuotes();
      });
      attachDragHandlers(li);
      el.editList.appendChild(li);
    });
  }

  // Riordino via trascinamento (Pointer Events, funziona anche a schermo
  // touch): tenendo premuto sull'icona ☰ si sposta la riga tra le altre;
  // l'ordine viene salvato al rilascio.
  function attachDragHandlers(li) {
    const handle = li.querySelector(".drag-handle");
    if (!handle) return;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      li.classList.add("dragging");

      function onMove(ev) {
        const afterElement = getDragAfterElement(el.editList, ev.clientY);
        if (afterElement == null) el.editList.appendChild(li);
        else el.editList.insertBefore(li, afterElement);
      }
      function onUp() {
        li.classList.remove("dragging");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        commitEditListOrder();
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }
  function getDragAfterElement(container, y) {
    const rows = [...container.querySelectorAll(".edit-row:not(.dragging)")];
    return rows.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }
  function commitEditListOrder() {
    const order = Array.from(el.editList.children).map((li) => li.dataset.symbol);
    const symbols = currentSymbols();
    symbols.sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
    savePages();
    renderList();
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
  /* Refresh dati — recupera le quotazioni di TUTTE le pagine insieme,   */
  /* così lo swipe tra pagine non richiede una nuova chiamata di rete.   */
  /* ----------------------------------------------------------------- */
  async function refreshQuotes() {
    const symbols = allSymbols();
    if (!symbols.length) { renderList(); return; }
    const data = await fetchQuotes(symbols);
    state.quotes = data;
    let anyOffline = false;
    Object.values(data).forEach(q => { if (q.offline) anyOffline = true; });
    el.footerText.textContent = anyOffline
      ? "Modalità dimostrativa — nessuna connessione al provider"
      : "Quotazioni ritardate di 20 minuti";
    if (!state.activeSymbol || !symbols.includes(state.activeSymbol)) {
      const first = currentSymbols()[0];
      state.activeSymbol = first ? first.symbol : (symbols[0] || null);
    }
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
  if (el.backCloseBtn) el.backCloseBtn.addEventListener("click", () => toggleFlip(false));

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
    const symbols = currentSymbols();
    if (symbols.find(w => w.symbol === symbol)) return;
    symbols.push({ symbol, name: name || "" });
    savePages();
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
    renderPageDots();
    renderList();
    await refreshQuotes();
    setInterval(refreshQuotes, 60000); // aggiornamento periodico, come l'app originale
  }
  init();
})();
