import { useContext, onCleanup } from 'solid-js';
import { collapsedSections, toggleSection } from '../../stores/propertiesStore.js';
import {
  SectieContext, sleepSectie, dropDoel, beginSlepen, zetDropDoel, stopSlepen, verschuifSectie,
} from '../../stores/sectieVolgordeStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Pas na deze afstand (px) is een ingedrukte kop een sleepbeweging; een
// gewone klik klapt de sectie in of uit (#967).
const SLEEP_DREMPEL = 5;

function zichtbareSecties() {
  const paneel = document.getElementById('properties-panel');
  if (!paneel) return [];
  return [...paneel.querySelectorAll('[data-sectie]')].map(el => el.dataset.sectie);
}

export default function CollapsibleSection(props) {
  const { t } = useTranslation('properties');
  const isCollapsed = () => collapsedSections()[props.name] || false;
  // Verplaatsbaar alleen binnen de sectielijst van het paneel (PropertiesPanel).
  const sleutel = useContext(SectieContext);
  let negeerKlik = false;
  let opruimen = null;
  onCleanup(() => opruimen?.());

  function doelOnder(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('#properties-panel [data-sectie]');
    if (!el || el.dataset.sectie === sleutel) return null;
    const r = el.getBoundingClientRect();
    return { sleutel: el.dataset.sectie, erna: y > r.top + r.height / 2 };
  }

  function onPointerDown(e) {
    if (!sleutel || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const paneel = document.getElementById('properties-panel');
    let sleept = false;
    const beweeg = (ev) => {
      if (!sleept) {
        if (Math.abs(ev.clientX - sx) < SLEEP_DREMPEL && Math.abs(ev.clientY - sy) < SLEEP_DREMPEL) return;
        sleept = true;
        beginSlepen(sleutel);
      }
      ev.preventDefault();
      // Bij de rand van het paneel meescrollen.
      if (paneel) {
        const r = paneel.getBoundingClientRect();
        if (ev.clientY < r.top + 24) paneel.scrollTop -= 12;
        else if (ev.clientY > r.bottom - 24) paneel.scrollTop += 12;
      }
      zetDropDoel(doelOnder(ev.clientX, ev.clientY));
    };
    const toets = (ev) => {
      if (ev.key !== 'Escape' || !sleept) return;
      ev.stopPropagation();
      sleept = false;
      stopSlepen(false);
      einde();
    };
    const los = () => {
      if (sleept) {
        // De klik die op het loslaten volgt is geen in-/uitklappen.
        negeerKlik = true;
        setTimeout(() => { negeerKlik = false; }, 0);
        stopSlepen(true);
      }
      einde();
    };
    function einde() {
      document.removeEventListener('pointermove', beweeg);
      document.removeEventListener('pointerup', los);
      document.removeEventListener('pointercancel', los);
      document.removeEventListener('keydown', toets, true);
      opruimen = null;
    }
    document.addEventListener('pointermove', beweeg);
    document.addEventListener('pointerup', los);
    document.addEventListener('pointercancel', los);
    document.addEventListener('keydown', toets, true);
    opruimen = () => { if (sleept) stopSlepen(false); einde(); };
  }

  function onClick() {
    if (negeerKlik) return;
    toggleSection(props.name);
  }

  function onKeyDown(e) {
    if (!sleutel) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      verschuifSectie(sleutel, e.key === 'ArrowUp' ? -1 : 1, zichtbareSecties());
      // De kop verhuist in de DOM; de focus erop terugzetten.
      queueMicrotask(() => {
        document.querySelector(`#properties-panel [data-sectie="${sleutel}"] .property-section-header`)?.focus();
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      toggleSection(props.name);
    }
  }

  const klassen = () => {
    let k = `property-section${isCollapsed() ? ' collapsed' : ''}`;
    if (sleutel) {
      if (sleepSectie() === sleutel) k += ' sectie-sleept';
      const d = dropDoel();
      if (d && d.sleutel === sleutel) k += d.erna ? ' sectie-drop-na' : ' sectie-drop-voor';
    }
    return k;
  };

  return (
    <div class={klassen()}
      id={props.id || undefined}
      data-sectie={sleutel || undefined}
      style={props.style || undefined}>
      <div class="property-section-header"
        tabIndex={sleutel ? 0 : undefined}
        title={sleutel ? t('sectionOrder.dragHint') : undefined}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onKeyDown={onKeyDown}>
        {props.title} <span class="collapse-arrow">&#9660;</span>
      </div>
      <div class="property-section-content">
        {props.children}
      </div>
    </div>
  );
}
