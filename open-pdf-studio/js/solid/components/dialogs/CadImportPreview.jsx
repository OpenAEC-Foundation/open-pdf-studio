import { batch, createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  maakVertrager, maakBeeldwissel, voorbeeldMaat, vensterUitVoorbeeld, voorbeeldSleutel,
  VOORBEELD_VERTRAGING_MS, VOORBEELD_MIN_SLEEP,
} from '../../../pdf/cad-import-voorbeeld.js';
import {
  annuleerImport, gooiVoorbeeldWeg, nieuwJobId, tekenPdfNaarBitmap, voorbeeldTekening,
} from '../../../pdf/cad-import.js';

const PT_PER_MM = 72 / 25.4;

/**
 * Voorbeeldweergave van het importvenster (#400).
 *
 * Draait de echte omzetter naar een tijdelijke PDF en toont die via de
 * renderroute van de app: wat je ziet is wat je krijgt. Vertraagd na de
 * laatste wijziging, af te breken, en de laatste opdracht wint. Slepen in het
 * beeld zet het venster (alleen als `onVenster` gegeven is).
 *
 * props: `args` (het argumentenpakket van de import, zonder uitvoerpad),
 * `actief`, `mmPerEenheid`, `draaiing`, `marge`, `onVenster`, `onMelding`.
 */
export default function CadImportPreview(props) {
  const { t } = useTranslation('dialogs');
  const [bitmap, setBitmap] = createSignal(null);
  const [maat, setMaat] = createSignal(null);
  const [bezig, setBezig] = createSignal(false);
  const [fout, setFout] = createSignal('');
  const [sleep, setSleep] = createSignal(null);

  let vak;
  let canvas;
  let job = null;
  let laatste = '';
  let weg = false;
  // Het verslag van de pagina die nu in beeld staat, met de draaiing en de
  // eenheid waarmee zij gemaakt is: slepen rekent daarmee terug.
  let getoond = null;
  const vertrager = maakVertrager(VOORBEELD_VERTRAGING_MS);
  // Bewaakt dat het oude beeld pas dichtgaat als het nieuwe staat, en dat een
  // gesloten beeld nooit getekend wordt.
  const beelden = maakBeeldwissel();

  const breekAf = () => {
    if (job) annuleerImport(job);
    job = null;
  };

  onCleanup(() => {
    weg = true;
    vertrager.stop();
    breekAf();
    beelden.sluit(bitmap());
  });

  async function draai() {
    const args = props.args;
    if (weg || !args?.path || !props.actief) return;
    const sleutel = voorbeeldSleutel(args);
    if (sleutel === laatste && bitmap()) return;
    // De laatste opdracht wint: wat nog loopt, wordt afgebroken.
    breekAf();
    setFout('');
    setBezig(true);
    job = nieuwJobId('preview');
    const dezeJob = job;
    const stand = { mmPerEenheid: props.mmPerEenheid, draaiing: props.draaiing };
    let pad = null;
    try {
      const verslag = await voorbeeldTekening(dezeJob, args);
      pad = verslag?.outputPath || null;
      if (weg || dezeJob !== job) return;
      const blad = verslag?.pages?.[0];
      if (!blad) throw new Error('geen pagina');
      const vakPx = { breedte: vak?.clientWidth || 280, hoogte: vak?.clientHeight || 360 };
      const m = voorbeeldMaat({ breedte: blad.widthMm, hoogte: blad.heightMm }, vakPx);
      if (!m) throw new Error('geen maat');
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const bmp = await tekenPdfNaarBitmap(
        pad,
        blad.widthMm * PT_PER_MM,
        blad.heightMm * PT_PER_MM,
        (m.pixelsPerMm * dpr) / PT_PER_MM,
      );
      if (weg || dezeJob !== job) {
        beelden.sluit(bmp);
        return;
      }
      if (!bmp) throw new Error('geen beeld');
      getoond = { blad, ...stand };
      // Maat en beeld in één keer: het venster tekent dan één keer, met het
      // nieuwe beeld. Het oude gaat daarna pas dicht — een maat zetten tekent
      // meteen opnieuw, en een gesloten beeld tekenen gooit.
      beelden.wissel(bitmap(), bmp, (nieuw) => batch(() => {
        setMaat({ ...m, dpr });
        setBitmap(nieuw);
      }));
      laatste = sleutel;
      props.onMelding?.(verslag.simplified === true ? { sleutel: 'previewSimplified' } : null);
    } catch {
      // Afgelost door een nieuwere opdracht: die meldt zich zelf.
      if (!weg && dezeJob === job) {
        setFout(t('cadImport.previewFailed'));
        props.onMelding?.(null);
      }
    } finally {
      // Het beeld staat in het geheugen; het bestand is niet meer nodig.
      if (pad) gooiVoorbeeldWeg(pad);
      if (dezeJob === job) {
        job = null;
        if (!weg) setBezig(false);
      }
    }
  }

  // Elke wijziging van de argumenten plant een nieuwe omzetting.
  createEffect(() => {
    const sleutel = voorbeeldSleutel(props.args);
    if (!props.actief || !sleutel) {
      vertrager.stop();
      breekAf();
      setBezig(false);
      return;
    }
    vertrager.plan(() => { draai().catch(() => {}); });
  });

  // Een tekenfout mag het voorbeeld niet uitzetten: zij zou anders uit het
  // zetten van een signaal omhoog komen en de omzetting of het slepen afbreken.
  function teken() {
    // Eerst lezen, zodat het effect ook na een fout blijft volgen.
    const m = maat();
    const bmp = bitmap();
    const s = sleep();
    try {
      tekenBeeld(m, bmp, s);
    } catch (e) {
      console.warn('[cad-import] voorbeeld tekenen mislukt:', e);
    }
  }

  function tekenBeeld(m, bmp, s) {
    if (!canvas || !m) return;
    const b = Math.round(m.breedte * m.dpr);
    const h = Math.round(m.hoogte * m.dpr);
    if (canvas.width !== b) canvas.width = b;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = `${m.breedte}px`;
    canvas.style.height = `${m.hoogte}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Papier.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, b, h);
    if (beelden.tekenbaar(bmp)) ctx.drawImage(bmp, 0, 0, b, h);
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    ctx.lineWidth = 1;
    // Marge.
    const marge = Number(props.marge) || 0;
    const d = marge * m.pixelsPerMm;
    if (d > 0 && m.breedte > 2 * d && m.hoogte > 2 * d) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#9a9a9a';
      ctx.strokeRect(Math.round(d) + 0.5, Math.round(d) + 0.5, Math.round(m.breedte - 2 * d) - 1, Math.round(m.hoogte - 2 * d) - 1);
      ctx.setLineDash([]);
    }
    if (s) {
      ctx.fillStyle = 'rgba(10, 92, 168, 0.12)';
      ctx.fillRect(s.x, s.y, s.breedte, s.hoogte);
      ctx.strokeStyle = '#0a5ca8';
      ctx.strokeRect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.breedte), Math.round(s.hoogte));
    }
  }
  createEffect(teken);
  onMount(teken);

  const puntIn = (e) => {
    const r = canvas.getBoundingClientRect();
    const m = maat();
    return {
      x: Math.min(m.breedte, Math.max(0, e.clientX - r.left)),
      y: Math.min(m.hoogte, Math.max(0, e.clientY - r.top)),
    };
  };
  const sleepbaar = () => typeof props.onVenster === 'function' && !!maat() && !!getoond;

  return (
    <div class="cad-voorbeeld">
      <div class="cad-voorbeeld-kop">
        <span>{t('cadImport.preview')}</span>
        <Show when={bezig()}><span class="cad-note">{t('cadImport.previewBusy')}</span></Show>
      </div>
      <div class="cad-voorbeeld-vak" ref={vak}>
        <canvas
          ref={canvas}
          class="cad-voorbeeld-beeld"
          classList={{ 'cad-voorbeeld-leeg': !maat() }}
          onPointerDown={(e) => {
            if (e.button !== 0 || !sleepbaar()) return;
            const p = puntIn(e);
            setSleep({ x: p.x, y: p.y, breedte: 0, hoogte: 0, vanX: p.x, vanY: p.y });
            try { canvas.setPointerCapture(e.pointerId); } catch { /* geen vangst */ }
          }}
          onPointerMove={(e) => {
            const s = sleep();
            if (!s) return;
            const p = puntIn(e);
            setSleep({
              ...s,
              x: Math.min(s.vanX, p.x),
              y: Math.min(s.vanY, p.y),
              breedte: Math.abs(p.x - s.vanX),
              hoogte: Math.abs(p.y - s.vanY),
            });
          }}
          onPointerUp={(e) => {
            const s = sleep();
            setSleep(null);
            try { canvas.releasePointerCapture(e.pointerId); } catch { /* al los */ }
            if (!s || s.breedte < VOORBEELD_MIN_SLEEP || s.hoogte < VOORBEELD_MIN_SLEEP || !getoond) return;
            const venster = vensterUitVoorbeeld(s, getoond.blad, getoond.mmPerEenheid, maat()?.pixelsPerMm, getoond.draaiing);
            if (venster) props.onVenster?.(venster);
          }}
          onPointerCancel={() => setSleep(null)}
        />
      </div>
      <Show when={fout()} fallback={
        <Show when={typeof props.onVenster === 'function'}>
          <span class="cad-note">{t('cadImport.previewWindowHint')}</span>
        </Show>
      }>
        <span class="cad-status cad-status-fout" role="alert">{fout()}</span>
      </Show>
    </div>
  );
}
