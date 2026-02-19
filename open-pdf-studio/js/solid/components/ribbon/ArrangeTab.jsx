import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { state } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { bringToFront, sendToBack, bringForward, sendBackward } from '../../../annotations/z-order.js';
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

export default function ArrangeTab() {
  return (
    <div class="ribbon-content active" id="tab-arrange">
      <div class="ribbon-groups">
        <RibbonGroup label="Alignment">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-align-left" title="Align Left" disabled={isPdfAReadOnly()} onClick={alignLeft}>
              <span ref={el => { el.innerHTML = alignLeftIcon; }} />
              <span>Left</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-center" title="Align Center" disabled={isPdfAReadOnly()} onClick={alignCenter}>
              <span ref={el => { el.innerHTML = alignCenterIcon; }} />
              <span>Center</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-right" title="Align Right" disabled={isPdfAReadOnly()} onClick={alignRight}>
              <span ref={el => { el.innerHTML = alignRightIcon; }} />
              <span>Right</span>
            </button>
          </div>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-align-top" title="Align Top" disabled={isPdfAReadOnly()} onClick={alignTop}>
              <span ref={el => { el.innerHTML = alignTopIcon; }} />
              <span>Top</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-middle" title="Align Middle" disabled={isPdfAReadOnly()} onClick={alignMiddle}>
              <span ref={el => { el.innerHTML = alignMiddleIcon; }} />
              <span>Middle</span>
            </button>
            <button class="ribbon-row-btn" id="arr-align-bottom" title="Align Bottom" disabled={isPdfAReadOnly()} onClick={alignBottom}>
              <span ref={el => { el.innerHTML = alignBottomIcon; }} />
              <span>Bottom</span>
            </button>
          </div>
          <div class="ribbon-grid-col">
            <div class="ribbon-grid-spacer"></div>
            <div class="ribbon-grid-spacer"></div>
            <button class="ribbon-row-btn ribbon-dropdown-btn" id="arr-align-to" title="Align To" disabled={isPdfAReadOnly()}>
              <span>Align to Selection</span>
              <svg class="dropdown-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label="Distribute">
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-space-h" title="Space Horizontally" icon={distSpaceHIcon} label="Space H."
              disabled={isPdfAReadOnly()} onClick={distributeSpaceH} />
            <RibbonButton size="medium" id="arr-dist-space-v" title="Space Vertically" icon={distSpaceVIcon} label="Space V."
              disabled={isPdfAReadOnly()} onClick={distributeSpaceV} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-left" title="Distribute Left" icon={distLeftIcon} label="Left"
              disabled={isPdfAReadOnly()} onClick={distributeLeft} />
            <RibbonButton size="medium" id="arr-dist-top" title="Distribute Top" icon={distTopIcon} label="Top"
              disabled={isPdfAReadOnly()} onClick={distributeTop} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-center" title="Distribute Center" icon={distCenterIcon} label="Center"
              disabled={isPdfAReadOnly()} onClick={distributeCenter} />
            <RibbonButton size="medium" id="arr-dist-middle" title="Distribute Middle" icon={distMiddleIcon} label="Middle"
              disabled={isPdfAReadOnly()} onClick={distributeMiddle} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="arr-dist-right" title="Distribute Right" icon={distRightIcon} label="Right"
              disabled={isPdfAReadOnly()} onClick={distributeRight} />
            <RibbonButton size="medium" id="arr-dist-bottom" title="Distribute Bottom" icon={distBottomIcon} label="Bottom"
              disabled={isPdfAReadOnly()} onClick={distributeBottom} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label="Size">
          <div class="ribbon-big-icon" ref={el => { el.innerHTML = sameSize16Icon; }}></div>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-same-size" title="Same Size" disabled={isPdfAReadOnly()}><span>Same Size</span></button>
            <button class="ribbon-row-btn" id="arr-same-width" title="Same Width" disabled={isPdfAReadOnly()}><span>Same Width</span></button>
            <button class="ribbon-row-btn" id="arr-same-height" title="Same Height" disabled={isPdfAReadOnly()}><span>Same Height</span></button>
          </div>
        </RibbonGroup>

        <RibbonGroup label="Rotate">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-rotate-ccw" title="Rotate 90° CCW" disabled={isPdfAReadOnly()}>
              <span ref={el => { el.innerHTML = rotateCcwIcon; }} />
              <span>Rotate 90° CCW</span>
            </button>
            <button class="ribbon-row-btn" id="arr-rotate-cw" title="Rotate 90° CW" disabled={isPdfAReadOnly()}>
              <span ref={el => { el.innerHTML = rotateCwIcon; }} />
              <span>Rotate 90° CW</span>
            </button>
            <button class="ribbon-row-btn" id="arr-rotate-180" title="Rotate 180°" disabled={isPdfAReadOnly()}>
              <span ref={el => { el.innerHTML = rotate180Icon; }} />
              <span>Rotate 180°</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label="Reflect">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-flip-h" title="Flip Horizontally" disabled={isPdfAReadOnly()}>
              <span ref={el => { el.innerHTML = flipHIcon; }} />
              <span>Horizontally</span>
            </button>
            <button class="ribbon-row-btn" id="arr-flip-v" title="Flip Vertically" disabled={isPdfAReadOnly()}>
              <span ref={el => { el.innerHTML = flipVIcon; }} />
              <span>Vertically</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label="Z-Order">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-bring-forward" title="Bring Forward"
              disabled={isPdfAReadOnly()} onClick={() => { for (const ann of state.selectedAnnotations) bringForward(ann); }}>
              <span ref={el => { el.innerHTML = bringForwardIcon; }} />
              <span>Bring Forward</span>
            </button>
            <button class="ribbon-row-btn" id="arr-bring-front" title="Bring to Front"
              disabled={isPdfAReadOnly()} onClick={() => { for (const ann of state.selectedAnnotations) bringToFront(ann); }}>
              <span ref={el => { el.innerHTML = bringToFrontIcon; }} />
              <span>Bring to Front</span>
            </button>
          </div>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="arr-send-backward" title="Send Backward"
              disabled={isPdfAReadOnly()} onClick={() => { for (const ann of [...state.selectedAnnotations].reverse()) sendBackward(ann); }}>
              <span ref={el => { el.innerHTML = sendBackwardIcon; }} />
              <span>Send Backward</span>
            </button>
            <button class="ribbon-row-btn" id="arr-send-back" title="Send to Back"
              disabled={isPdfAReadOnly()} onClick={() => { for (const ann of [...state.selectedAnnotations].reverse()) sendToBack(ann); }}>
              <span ref={el => { el.innerHTML = sendToBackIcon; }} />
              <span>Send to Back</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label="Transform">
          <div class="ribbon-transform-grid">
            <div class="ribbon-transform-row">
              <label>X:</label>
              <input type="number" class="ribbon-transform-input" id="arr-pos-x" step="0.01" disabled={isPdfAReadOnly()} />
              <span class="ribbon-transform-unit">mm</span>
              <label>W:</label>
              <input type="number" class="ribbon-transform-input" id="arr-size-w" step="0.01" disabled={isPdfAReadOnly()} />
              <span class="ribbon-transform-unit">mm</span>
            </div>
            <div class="ribbon-transform-row">
              <label>Y:</label>
              <input type="number" class="ribbon-transform-input" id="arr-pos-y" step="0.01" disabled={isPdfAReadOnly()} />
              <span class="ribbon-transform-unit">mm</span>
              <label>H:</label>
              <input type="number" class="ribbon-transform-input" id="arr-size-h" step="0.01" disabled={isPdfAReadOnly()} />
              <span class="ribbon-transform-unit">mm</span>
            </div>
          </div>
        </RibbonGroup>
      </div>
    </div>
  );
}
