import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { state, getActiveDocument } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { bringToFront, sendToBack, bringForward, sendBackward, flipHorizontal, flipVertical, rotateAnnotation } from '../../../annotations/z-order.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { recordBulkModify } from '../../../core/undo-manager.js';
import {
  alignLeft, alignCenter, alignRight, alignTop, alignMiddle, alignBottom,
  distributeSpaceH, distributeSpaceV, distributeLeft, distributeCenter,
  distributeRight, distributeTop, distributeMiddle, distributeBottom
} from '../../../annotations/alignment.js';
import {
  alignLeftIcon, alignCenterIcon, alignRightIcon, alignTopIcon, alignMiddleIcon, alignBottomIcon,
  distSpaceHIcon, distSpaceVIcon, distLeftIcon, distTopIcon, distCenterIcon, distMiddleIcon, distRightIcon, distBottomIcon,
  bringForwardIcon, bringToFrontIcon, sendBackwardIcon, sendToBackIcon,
  sameSize16Icon, rotateCcwIcon, rotateCwIcon, rotate180Icon, flipHIcon, flipVIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ArrangeTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-arrange">
      <AdaptiveGroups>
        <RibbonGroup label={t('arrange.alignment')}>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-align-left" title={t('arrange.alignLeft')} disabled={isPdfAReadOnly()} onClick={alignLeft}>
              <span ref={el => { el.innerHTML = alignLeftIcon; }} />
              <span>{t('arrange.left')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-center" title={t('arrange.alignCenter')} disabled={isPdfAReadOnly()} onClick={alignCenter}>
              <span ref={el => { el.innerHTML = alignCenterIcon; }} />
              <span>{t('arrange.center')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-right" title={t('arrange.alignRight')} disabled={isPdfAReadOnly()} onClick={alignRight}>
              <span ref={el => { el.innerHTML = alignRightIcon; }} />
              <span>{t('arrange.right')}</span>
            </button>
          </div>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-align-top" title={t('arrange.alignTop')} disabled={isPdfAReadOnly()} onClick={alignTop}>
              <span ref={el => { el.innerHTML = alignTopIcon; }} />
              <span>{t('arrange.top')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-middle" title={t('arrange.alignMiddle')} disabled={isPdfAReadOnly()} onClick={alignMiddle}>
              <span ref={el => { el.innerHTML = alignMiddleIcon; }} />
              <span>{t('arrange.middle')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-bottom" title={t('arrange.alignBottom')} disabled={isPdfAReadOnly()} onClick={alignBottom}>
              <span ref={el => { el.innerHTML = alignBottomIcon; }} />
              <span>{t('arrange.bottom')}</span>
            </button>
          </div>
          <div class="ribbon-grid-col">
            <div class="ribbon-grid-spacer"></div>
            <div class="ribbon-grid-spacer"></div>
            <button class="ribbon-row-btn ribbon-dropdown-btn" id="arr-align-to" title={t('arrange.alignTo')} disabled={isPdfAReadOnly()}>
              <span>{t('arrange.alignToSelection')}</span>
              <svg class="dropdown-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('arrange.distribute')}>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-space-h" title={t('arrange.spaceHorizontally')} icon={distSpaceHIcon} label={t('arrange.spaceH')}
              disabled={isPdfAReadOnly()} onClick={distributeSpaceH} />
            <RibbonButton size="medium" id="arr-dist-space-v" title={t('arrange.spaceVertically')} icon={distSpaceVIcon} label={t('arrange.spaceV')}
              disabled={isPdfAReadOnly()} onClick={distributeSpaceV} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-left" title={t('arrange.distributeLeft')} icon={distLeftIcon} label={t('arrange.left')}
              disabled={isPdfAReadOnly()} onClick={distributeLeft} />
            <RibbonButton size="medium" id="arr-dist-top" title={t('arrange.distributeTop')} icon={distTopIcon} label={t('arrange.top')}
              disabled={isPdfAReadOnly()} onClick={distributeTop} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-center" title={t('arrange.distributeCenter')} icon={distCenterIcon} label={t('arrange.center')}
              disabled={isPdfAReadOnly()} onClick={distributeCenter} />
            <RibbonButton size="medium" id="arr-dist-middle" title={t('arrange.distributeMiddle')} icon={distMiddleIcon} label={t('arrange.middle')}
              disabled={isPdfAReadOnly()} onClick={distributeMiddle} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-right" title={t('arrange.distributeRight')} icon={distRightIcon} label={t('arrange.right')}
              disabled={isPdfAReadOnly()} onClick={distributeRight} />
            <RibbonButton size="medium" id="arr-dist-bottom" title={t('arrange.distributeBottom')} icon={distBottomIcon} label={t('arrange.bottom')}
              disabled={isPdfAReadOnly()} onClick={distributeBottom} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('arrange.size')}>
          <div class="ribbon-big-icon" ref={el => { el.innerHTML = sameSize16Icon; }}></div>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-same-size" title={t('arrange.sameSize')} disabled={isPdfAReadOnly()}><span>{t('arrange.sameSize')}</span></button>
            <button class="ribbon-row-btn" id="arr-same-width" title={t('arrange.sameWidth')} disabled={isPdfAReadOnly()}><span>{t('arrange.sameWidth')}</span></button>
            <button class="ribbon-row-btn" id="arr-same-height" title={t('arrange.sameHeight')} disabled={isPdfAReadOnly()}><span>{t('arrange.sameHeight')}</span></button>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('arrange.rotate')}>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-rotate-ccw" title={t('arrange.rotate90CCW')} disabled={isPdfAReadOnly()}
              onClick={() => {
                const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
                const originals = anns.map(a => cloneAnnotation(a));
                for (const ann of anns) rotateAnnotation(ann, -90);
                recordBulkModify(anns, originals);
              }}>
              <span ref={el => { el.innerHTML = rotateCcwIcon; }} />
              <span>{t('arrange.rotate90CCW')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-rotate-cw" title={t('arrange.rotate90CW')} disabled={isPdfAReadOnly()}
              onClick={() => {
                const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
                const originals = anns.map(a => cloneAnnotation(a));
                for (const ann of anns) rotateAnnotation(ann, 90);
                recordBulkModify(anns, originals);
              }}>
              <span ref={el => { el.innerHTML = rotateCwIcon; }} />
              <span>{t('arrange.rotate90CW')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-rotate-180" title={t('arrange.rotate180')} disabled={isPdfAReadOnly()}
              onClick={() => {
                const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
                const originals = anns.map(a => cloneAnnotation(a));
                for (const ann of anns) rotateAnnotation(ann, 180);
                recordBulkModify(anns, originals);
              }}>
              <span ref={el => { el.innerHTML = rotate180Icon; }} />
              <span>{t('arrange.rotate180')}</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('arrange.reflect')}>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-flip-h" title={t('arrange.flipHorizontally')} disabled={isPdfAReadOnly()}
              onClick={() => {
                const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
                const originals = anns.map(a => cloneAnnotation(a));
                for (const ann of anns) flipHorizontal(ann);
                recordBulkModify(anns, originals);
              }}>
              <span ref={el => { el.innerHTML = flipHIcon; }} />
              <span>{t('arrange.horizontally')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-flip-v" title={t('arrange.flipVertically')} disabled={isPdfAReadOnly()}
              onClick={() => {
                const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
                const originals = anns.map(a => cloneAnnotation(a));
                for (const ann of anns) flipVertical(ann);
                recordBulkModify(anns, originals);
              }}>
              <span ref={el => { el.innerHTML = flipVIcon; }} />
              <span>{t('arrange.vertically')}</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('arrange.zOrder')}>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-bring-forward" title={t('arrange.bringForward')}
              disabled={isPdfAReadOnly()} onClick={() => bringForward(getActiveDocument()?.selectedAnnotations || [])}>
              <span ref={el => { el.innerHTML = bringForwardIcon; }} />
              <span>{t('arrange.bringForward')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-bring-front" title={t('arrange.bringToFront')}
              disabled={isPdfAReadOnly()} onClick={() => bringToFront(getActiveDocument()?.selectedAnnotations || [])}>
              <span ref={el => { el.innerHTML = bringToFrontIcon; }} />
              <span>{t('arrange.bringToFront')}</span>
            </button>
          </div>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-send-backward" title={t('arrange.sendBackward')}
              disabled={isPdfAReadOnly()} onClick={() => sendBackward(getActiveDocument()?.selectedAnnotations || [])}>
              <span ref={el => { el.innerHTML = sendBackwardIcon; }} />
              <span>{t('arrange.sendBackward')}</span>
            </button>
            <button class="ribbon-row-btn" id="arr-send-back" title={t('arrange.sendToBack')}
              disabled={isPdfAReadOnly()} onClick={() => sendToBack(getActiveDocument()?.selectedAnnotations || [])}>
              <span ref={el => { el.innerHTML = sendToBackIcon; }} />
              <span>{t('arrange.sendToBack')}</span>
            </button>
          </div>
        </RibbonGroup>

      </AdaptiveGroups>
    </div>
  );
}
