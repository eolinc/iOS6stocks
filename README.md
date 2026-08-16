# Borsa — Stocks di iOS 6, ricreato come PWA

Ricostruzione fedele, in HTML/CSS/JS puri, dell'app **Stocks** di iOS 6:
gradienti glossy, pillole rosse/verdi per la variazione, grafico su sfondo
blu notte con il classico riempimento a tratteggio diagonale sotto la
linea, selettore temporale a "segmented control", e il gesto di **flip**
della card grafico per aggiungere/rimuovere titoli — proprio come nella
schermata "impostazioni" dell'app originale.

## Come ho interpretato gli screenshot

Le quattro immagini fornite mostrano tutte la stessa interfaccia (lista
titoli in stile UITableView con righe a gradiente azzurro chiaro/scuro
alternato + card del grafico blu notte con tratteggio diagonale, controllo
a segmenti 1g/1s/1m/3m/6m/1y/2y, badge in basso a sinistra, testo
"Quotazioni ritardate" al centro, pulsante "i" in basso a destra), fotografata
su dispositivi e in stati diversi (mercato aperto/chiuso, simboli vuoti,
errore di caricamento del grafico — "Error Retrieving Chart" nell'ultima
immagine). Ho quindi trattato questi elementi come:

- **Statici** (stile, non contenuto): il layout a due card, i gradienti, i
  bordi, la tipografia, il badge in basso a sinistra, il pulsante "i",
  il tratteggio diagonale del grafico, il segmented control.
- **Dinamici**: simboli, nomi società, prezzi, variazioni (assolute e
  percentuali, con colore rosso/verde), punti del grafico, stato
  "mercato chiuso" / "errore recupero grafico" quando i dati mancano.

Il pulsante "i" riproduce il comportamento originale dell'app: capovolge
la card con un'animazione 3D (`rotateY`) rivelando la schermata di
modifica dei titoli (aggiunta, rimozione, riordino) e la scelta di cosa
mostrare nella colonna destra della lista (prezzo assoluto, percentuale o
capitalizzazione) — dettaglio non visibile negli screenshot ma coerente
con il comportamento noto dell'app originale, per cui ho scelto questa
soluzione invece di inventare una UI moderna (es. un pannello impostazioni
in stile Material).

## Struttura del progetto

```
stocks-app/
├── index.html          # markup dell'app (lista + card grafico/impostazioni)
├── css/style.css        # tutto lo stile skeuomorfico iOS 6
├── js/app.js             # stato, rendering, disegno del grafico su canvas
├── manifest.json         # manifest PWA (installabile, standalone, icone)
├── sw.js                  # service worker: cache degli asset statici
├── icons/                 # icone generate (192/512, incluse le maskable)
└── server/                # backend proxy Node/Express (facoltativo ma consigliato)
    ├── server.js
    ├── package.json
    └── providers/
        ├── index.js               # registro provider (switch tramite env var)
        ├── stooqProvider.js       # provider di default, GRATUITO, nessuna chiave
        └── alphaVantageProvider.js # esempio di provider "a chiave"
```

## Perché un backend separato

Le API key non devono mai finire nel frontend (sarebbero visibili a
chiunque apra gli strumenti sviluppatore). Il backend in `server/` espone
tre endpoint semplici e stabili al frontend:

- `GET /api/quote?symbols=AAPL,MSFT` → quotazioni correnti
- `GET /api/history?symbol=AAPL&range=1m` → serie storica per il grafico
- `GET /api/search?q=appl` → ricerca ticker

Il provider reale (Stooq, Alpha Vantage, o qualunque altro) è collegato
dietro questi endpoint e si cambia con la variabile d'ambiente `PROVIDER`,
senza toccare una riga di frontend. Questo soddisfa il requisito di poter
cambiare fornitore di dati in futuro senza riscrivere l'app.

**Se il backend non è in esecuzione** (ad esempio quando apri semplicemente
`index.html` da file statico), il frontend passa automaticamente a una
modalità dimostrativa con dati generati localmente, e lo segnala nel testo
in basso ("Modalità dimostrativa"). Così l'interfaccia resta sempre
utilizzabile e ispezionabile, ma non finge mai di mostrare dati di mercato
reali quando non lo sono.

## Avvio

### Solo frontend (demo, nessun dato reale)
Apri `index.html` con un qualunque server statico (va bene anche
`npx serve .`) — l'app funziona già in modalità dimostrativa.

### Con dati reali (provider Stooq, gratuito, nessuna chiave)
```bash
cd server
npm install
npm start
# apri http://localhost:8787
```

### Con un altro provider (es. Alpha Vantage)
```bash
cd server
npm install
PROVIDER=alphavantage ALPHA_VANTAGE_API_KEY=la_tua_chiave npm start
```

## Pagine multiple, riordino e navigazione

Come nel widget originale (le immagini di riferimento mostravano più
"pagine" di titoli, indicate dai puntini in basso), l'app supporta più
liste di titoli:

- **Swipe** orizzontale sulla lista per passare da una pagina all'altra
  (lo scroll verticale della lista continua a funzionare normalmente).
- **Tocco su un puntino** in basso per saltare direttamente a quella pagina.
- Di default ci sono due pagine — "Titoli" (indici) e "Azioni" (Apple,
  Alphabet) — modificabili liberamente. Per aggiungere altre pagine oltre
  a queste due, va estesa la costante `DEFAULT_PAGES` in `js/app.js`
  (funzionalità non ancora esposta come pulsante nell'interfaccia).
- Nella facciata di modifica (pulsante "i"), i titoli della pagina
  corrente si possono **riordinare trascinandoli** dall'icona ☰: tieni
  premuto e sposta la riga nella nuova posizione, l'ordine si salva al
  rilascio.
- Sempre nella facciata di modifica, il pulsante **‹** in alto a destra
  torna al grafico — prima quel percorso non aveva un modo esplicito per
  tornare indietro, ora sì (oltre a poter ritoccare di nuovo il pulsante
  "i").

## Cornice iPhone 4

L'app è sempre renderizzata dentro una cornice grafica che riproduce
l'iPhone 4 (schermo interno a 320×480px, la risoluzione reale del
dispositivo originale), centrata e scalata automaticamente per adattarsi a
qualunque finestra o schermo (`js/frame-scale.js`), senza mai generare
scroll o tagliare contenuto. È una scelta estetica volontaria coerente col
tema dell'app: **non** è più una PWA a schermo intero come nella prima
versione — anche una volta installata su Android, l'app apparirà "dentro"
la cornice invece di riempire tutto lo schermo del telefono reale. Se in
futuro preferisci tornare al comportamento a schermo intero, basta
rimuovere il wrapper `#deviceStage` / `#iphone4Frame` da `index.html` e i
relativi stili da `css/style.css`.

## Pubblicazione su GitHub Pages

GitHub Pages serve **solo file statici**: `index.html`, `css/`, `js/`,
`manifest.json`, `sw.js`, `icons/` funzionano lì senza modifiche (i percorsi
nel progetto sono già relativi, quindi va bene sia come sito utente
`tuoutente.github.io` sia come sito di progetto
`tuoutente.github.io/nome-repo/`). Quello che **non** può girare su Pages è
la cartella `server/` (richiede Node in esecuzione continua).

1. Metti il contenuto di questa cartella (`index.html`, `css/`, `js/`,
   `manifest.json`, `sw.js`, `icons/`) nella root del repository (o in
   `/docs` se preferisci quella modalità).
2. Impostazioni repo → **Pages** → scegli il branch/cartella → salva.
3. Il sito sarà online in un minuto o due all'URL indicato da GitHub.

A questo punto l'app **funziona già**, ma in modalità dimostrativa (dati
generati localmente, mai spacciati per reali — vedi sotto).

### Dati reali con GitHub Pages: serve un backend altrove

Poiché Pages non esegue codice server-side, la chiave (se il provider ne
richiede una) e la logica di chiamata al provider devono vivere su un
servizio separato che esegua funzioni gratuite. Due opzioni, entrambe senza
carta di credito:

**Opzione consigliata — Cloudflare Workers** (`server/worker.js`):
1. Crea un account gratuito su workers.cloudflare.com.
2. "Create application" → "Create Worker", incolla il contenuto di
   `server/worker.js`, **Deploy**.
3. Copia l'URL pubblico (`https://borsa-proxy.tuonome.workers.dev`).
4. Apri `js/config.js` nel sito Pages e imposta:
   ```js
   window.BORSA_API_BASE = "https://borsa-proxy.tuonome.workers.dev";
   ```
5. Ricarica il sito: ora `/api/quote`, `/api/history`, `/api/search`
   passano dal Worker, che usa Stooq (gratuito, nessuna chiave). Per un
   provider a pagamento, salva la chiave come **Secret** nelle impostazioni
   del Worker (mai nel codice del repository) e leggila da `env` — resta
   sempre lato server, mai visibile nel frontend su Pages.

**Opzione alternativa — hosting Node completo** (Render, Railway, Fly.io,
piano gratuito): pubblica lì la cartella `server/` così com'è (usa
`server/server.js` e i provider in `server/providers/`), poi punta
`js/config.js` all'URL ottenuto. Utile se preferisci restare su Node/Express
invece che sull'ambiente Workers.

In entrambi i casi il frontend statico rimane identico e resta su GitHub
Pages: cambia solo il valore in `js/config.js`.



1. Apri l'app nel browser (Chrome) all'indirizzo del server.
2. Menu ⋮ → **Installa app** (o il banner automatico "Aggiungi a
   schermata Home").
3. L'app si apre in modalità `standalone`, a schermo intero, con l'icona
   e il colore tema (`#12213e`, lo stesso blu notte del grafico) coerenti
   con l'estetica dell'app.

## Note di fedeltà / limiti onesti

- Stooq non fornisce l'intervallo "1 giorno" infragiornaliero nel piano
  gratuito: per quell'intervallo vengono mostrate le ultime barre
  giornaliere disponibili come approssimazione (commentato nel codice).
  Un provider con dati intraday (es. Alpha Vantage) risolve il limite.
- La variazione giornaliera calcolata da Stooq è un'approssimazione
  (chiusura − apertura), perché l'endpoint gratuito non restituisce la
  chiusura precedente in modo affidabile per tutti i mercati.
- I loghi/testi "Y!" originali sono un marchio Yahoo; il badge in basso a
  sinistra riprende posizione, forma e stile del riferimento ma è
  generico (non riproduce il logo Yahoo reale), per restare un'icona di
  "fonte dati" personalizzabile in base al provider effettivamente in uso.
