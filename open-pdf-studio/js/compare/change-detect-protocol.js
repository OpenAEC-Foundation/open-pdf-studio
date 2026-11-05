// Berichtprotocol en client voor de wijzigingsdetectie in een Web Worker (#465).
//
// detectChanges() (change-detector.js) doet een union-find over de hele
// detectiepagina en blokkeerde daarmee de hoofdthread. De worker
// (change-detect.worker.js) draait exact dezelfde functie; dit bestand bevat
// alles daaromheen en is puur (geen DOM), zodat het in node te testen is:
//
//   - buildDetectRequest / handleDetectMessage: het berichtformaat. De pixels
//     gaan als Uint8ClampedArray mee; buffers die de aanroeper niet meer nodig
//     heeft worden overgedragen (transferable) in plaats van gekopieerd.
//   - createDetectClient: één worker, één taak tegelijk, "laatste wint". Elke
//     aanvraag draagt een oplopend id; een aanvraag die is ingehaald door een
//     nieuwere voordat hij de worker bereikte wordt nooit verstuurd, en een
//     antwoord op een ingehaalde aanvraag wordt als `stale` gemeld.
//   - Zonder Worker (tests, sommige webhosts, CSP) of als de worker faalt,
//     rekent de client synchroon met dezelfde functie: zelfde invoer, zelfde
//     wijzigingen.

import { detectChanges } from './change-detector.js';
import { detectMaskChanges } from './mask-detect.js';
import { estimateAlignment } from './auto-align.js';
import { vectorTask } from './vector-diff.js';

/**
 * Tasks besides the classic RGBA diff. `old`/`new` are then ink masks
 * ({width, height, stride, data:Uint8Array}, see ink-mask.js):
 *   'masks' — detectMaskChanges(old, new, options)
 *   'align' — estimateAlignment(old, new, options)
 *   'vector' — diffSegments of {segments} (vector-diff.js)
 */
export const TASKS = Object.freeze({
  masks: detectMaskChanges,
  align: estimateAlignment,
  vector: vectorTask,
});

function _runTask(task, oldData, newData, threshold, options, detect) {
  if (task) {
    const fn = TASKS[task];
    if (!fn) throw new Error(`compare: unknown detection task ${task}`);
    return fn(oldData, newData, options || {});
  }
  return threshold === undefined ? detect(oldData, newData) : detect(oldData, newData, threshold);
}

export const DETECT_REQUEST = 'opds-detect';
export const DETECT_RESULT = 'opds-detect-result';
export const DETECT_ERROR = 'opds-detect-error';

/** Foutcode waarmee de client meldt dat de worker zelf onbruikbaar is. */
export const WORKER_UNAVAILABLE = 'detect-worker-unavailable';

function _pixels(img) {
  return img && img.data;
}

/**
 * Bouw een detectie-aanvraag voor de worker.
 * @param {number} id oplopend aanvraag-id
 * @param {{width:number,height:number,data:Uint8ClampedArray}} oldData
 * @param {{width:number,height:number,data:Uint8ClampedArray}} newData
 * @param {{threshold?:number, transferOld?:boolean, transferNew?:boolean}} [opts]
 *   transferOld/transferNew: de buffer van die kant overdragen (de aanroeper
 *   raakt hem kwijt). Niet overgedragen buffers worden door postMessage
 *   gekopieerd (structured clone).
 * @returns {{message:object, transfer:ArrayBuffer[]}}
 */
export function buildDetectRequest(id, oldData, newData, opts = {}) {
  const { threshold, transferOld = false, transferNew = false, task, options } = opts;
  const oldPx = _pixels(oldData);
  const newPx = _pixels(newData);
  const side = (img, px) => {
    const out = { width: img.width, height: img.height, data: px };
    if (img.stride !== undefined) out.stride = img.stride;
    return out;
  };
  const message = {
    type: DETECT_REQUEST,
    id,
    old: side(oldData, oldPx),
    new: side(newData, newPx),
  };
  if (threshold !== undefined) message.threshold = threshold;
  if (task) message.task = task;
  if (options !== undefined) message.options = options;
  const transfer = [];
  if (transferOld && oldPx && oldPx.buffer) transfer.push(oldPx.buffer);
  if (transferNew && newPx && newPx.buffer && newPx.buffer !== (oldPx && oldPx.buffer)) {
    transfer.push(newPx.buffer);
  }
  return { message, transfer };
}

/**
 * Verwerk een bericht in de worker. Geeft het antwoord terug, of null als het
 * bericht niet voor ons is.
 */
export function handleDetectMessage(message, detect = detectChanges) {
  if (!message || message.type !== DETECT_REQUEST) return null;
  const { id } = message;
  try {
    const changes = _runTask(message.task, message.old, message.new, message.threshold, message.options, detect);
    return { type: DETECT_RESULT, id, changes };
  } catch (err) {
    return { type: DETECT_ERROR, id, error: String((err && err.message) || err) };
  }
}

/** Koppel het protocol aan een worker-scope (`self` in de worker). */
export function attachDetectWorker(scope, detect = detectChanges) {
  scope.onmessage = (event) => {
    const reply = handleDetectMessage(event && event.data, detect);
    if (reply) scope.postMessage(reply);
  };
}

function _unavailable(cause) {
  const err = new Error('compare: detection worker unavailable' + (cause ? ` (${cause})` : ''));
  err.code = WORKER_UNAVAILABLE;
  return err;
}

/**
 * Client die detectie naar een worker stuurt.
 *
 * @param {{createWorker?: () => (Worker|null), detect?: Function}} [deps]
 *   createWorker: maakt de worker (lui, bij de eerste aanvraag). null of een
 *   exceptie = geen worker → synchroon rekenen.
 * @returns {{
 *   run(oldData, newData, opts?): Promise<{id:number, changes:Array|null, stale:boolean}>,
 *   latestId(): number,
 *   usesWorker(): boolean,
 *   dispose(): void,
 * }}
 *
 * run() lost op met:
 *   - changes = de wijzigingen, stale = false als dit nog de nieuwste aanvraag is;
 *   - changes = de wijzigingen, stale = true als hij onderweg is ingehaald
 *     (het resultaat klopt nog voor zijn eigen invoer, dus cachebaar);
 *   - changes = null, stale = true als hij is ingehaald vóór hij aan de beurt
 *     was (er is niets gerekend).
 * Een fout in de detectie zelf geeft een reject; faalt de worker als geheel,
 * dan is de reject-code WORKER_UNAVAILABLE en rekent de client daarna synchroon.
 */
export function createDetectClient(deps = {}) {
  const { createWorker = null, detect = detectChanges } = deps;
  let worker = null;
  let workerState = createWorker ? 'idle' : 'off'; // idle | on | off
  let latest = 0;
  let inFlight = null; // { id, resolve, reject }
  let pending = null;  // { id, oldData, newData, opts, resolve, reject }

  function _syncRun(id, oldData, newData, opts = {}) {
    const changes = _runTask(opts.task, oldData, newData, opts.threshold, opts.options, detect);
    return { id, changes, stale: id < latest };
  }

  function _failWorker(cause) {
    workerState = 'off';
    const w = worker;
    worker = null;
    try { w && w.terminate && w.terminate(); } catch (_) { /* al weg */ }
    const err = _unavailable(cause);
    const jobs = [inFlight, pending].filter(Boolean);
    inFlight = null;
    pending = null;
    for (const j of jobs) j.reject(err);
  }

  function _ensureWorker() {
    if (workerState === 'on') return worker;
    if (workerState === 'off') return null;
    try {
      worker = createWorker();
    } catch (_) {
      worker = null;
    }
    if (!worker) {
      workerState = 'off';
      return null;
    }
    workerState = 'on';
    worker.onmessage = (event) => _onReply(event && event.data);
    worker.onerror = (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      _failWorker((event && event.message) || 'error');
    };
    worker.onmessageerror = () => _failWorker('messageerror');
    return worker;
  }

  function _onReply(reply) {
    if (!reply || !inFlight || reply.id !== inFlight.id) return; // onbekend of al afgehandeld
    const job = inFlight;
    inFlight = null;
    if (reply.type === DETECT_RESULT) {
      job.resolve({ id: job.id, changes: reply.changes, stale: job.id < latest });
    } else if (reply.type === DETECT_ERROR) {
      job.reject(new Error(reply.error));
    } else {
      job.reject(new Error('compare: unexpected detection reply'));
    }
    _pump();
  }

  function _send(job) {
    const w = _ensureWorker();
    if (!w) {
      // Worker viel weg tussen aanvragen: synchroon afmaken.
      try {
        job.resolve(_syncRun(job.id, job.oldData, job.newData, job.opts));
      } catch (err) {
        job.reject(err);
      }
      return;
    }
    const { message, transfer } = buildDetectRequest(job.id, job.oldData, job.newData, job.opts);
    inFlight = { id: job.id, resolve: job.resolve, reject: job.reject };
    try {
      w.postMessage(message, transfer);
    } catch (err) {
      // Bijv. DataCloneError. De buffers kunnen al ontkoppeld zijn, dus de
      // aanroeper moet opnieuw beginnen (code WORKER_UNAVAILABLE).
      _failWorker(err && err.message);
    }
  }

  function _pump() {
    if (inFlight || !pending) return;
    const job = pending;
    pending = null;
    if (job.id < latest) {
      job.resolve({ id: job.id, changes: null, stale: true });
      _pump();
      return;
    }
    _send(job);
  }

  return {
    run(oldData, newData, opts = {}) {
      const id = Number.isFinite(opts.id) ? opts.id : latest + 1;
      if (id > latest) latest = id;
      if (id < latest) return Promise.resolve({ id, changes: null, stale: true });

      if (!_ensureWorker()) {
        try {
          return Promise.resolve(_syncRun(id, oldData, newData, opts));
        } catch (err) {
          return Promise.reject(err);
        }
      }

      return new Promise((resolve, reject) => {
        const job = { id, oldData, newData, opts, resolve, reject };
        if (pending) {
          // De wachtende aanvraag is ingehaald voordat hij de worker bereikte.
          pending.resolve({ id: pending.id, changes: null, stale: true });
        }
        pending = job;
        _pump();
      });
    },
    latestId() {
      return latest;
    },
    usesWorker() {
      return workerState !== 'off';
    },
    dispose() {
      const jobs = [inFlight, pending].filter(Boolean);
      inFlight = null;
      pending = null;
      for (const j of jobs) j.resolve({ id: j.id, changes: null, stale: true });
      try { worker && worker.terminate && worker.terminate(); } catch (_) { /* al weg */ }
      worker = null;
      if (workerState === 'on') workerState = 'idle';
    },
  };
}
