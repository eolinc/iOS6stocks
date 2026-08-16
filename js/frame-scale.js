/**
 * Scala la cornice dell'iPhone 4 per farla stare in qualunque finestra o
 * schermo (desktop, tablet, telefono con qualunque risoluzione), mantenendo
 * sempre le proporzioni reali del dispositivo e senza mai generare scroll.
 * La dimensione "vera" della cornice è fissata in css/style.css tramite le
 * variabili --phone-w/--phone-h; qui calcoliamo solo un fattore di scala.
 */
(() => {
  "use strict";
  const frame = document.getElementById("iphone4Frame");
  if (!frame) return;

  const MARGIN = 16; // spazio minimo attorno alla cornice

  function readVar(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const n = parseFloat(raw);
    return isFinite(n) ? n : fallback;
  }

  function applyScale() {
    const phoneW = readVar("--phone-w", 348);
    const phoneH = readVar("--phone-h", 604);
    const availW = window.innerWidth - MARGIN * 2;
    const availH = window.innerHeight - MARGIN * 2;
    const scale = Math.min(1, availW / phoneW, availH / phoneH);
    frame.style.transform = `scale(${scale})`;
  }

  applyScale();
  window.addEventListener("resize", applyScale);
  window.addEventListener("orientationchange", applyScale);
})();
