import { state, imageCache } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { generateImageId } from '../utils/helpers.js';
import { connectWindowClipboard, createWindowClipboard } from './window-clipboard-channel.js';

// Detached Tauri windows are independent processes. Their inherited native
// memory broker shares copies; browser windows use same-origin BroadcastChannel.
let channel, transport, closed=false;
const pending=[];
function send(packet) {
  if (!transport) { pending.splice(0,pending.length,packet); return; }
  return transport.send(packet);
}
async function prepare(annotations) {
  for (const a of annotations) {
    if (!a.imageId && !a.imageData) continue;
    // Source-window cache keys can collide with keys already in this window.
    a.imageId=generateImageId();
    if (typeof a.imageData !== 'string' || !a.imageData.startsWith('data:image/')) continue;
    const img=new Image(); img.src=a.imageData;
    await img.decode(); imageCache.set(a.imageId,img);
  }
  return annotations;
}
if (typeof window !== 'undefined') {
  channel=createWindowClipboard({send,prepare,apply(annotations,at) {
    state.clipboardAnnotation=annotations[0];
    state.clipboardAnnotations=annotations.length>1 ? annotations : null;
    state._internalCopyAt=at; state._pasteSeq=0;
  }});
  (async()=>{
    const invoke = window.__TAURI__?.core?.invoke;
    transport=await connectWindowClipboard(p=>channel.receive(p), {
      exchange: invoke ? (candidate,known)=>invoke('exchange_annotation_clipboard',{candidate,known}) : null,
      snapshot: ()=>channel.snapshot(),
      native:window.__TAURI__?.event,Broadcast:window.BroadcastChannel,
    });
    if (closed) { transport?.close(); return; }
    if (!transport) return;
    for (const p of pending.splice(0)) send(p); channel.request();
  })().catch(()=>{});
  window.addEventListener?.('pagehide',()=>{closed=true;channel.stop();transport?.close();pending.length=0;},{once:true});
  window.addEventListener?.('focus',()=>{transport?.refresh?.().catch(()=>{});});
}

/** A paste can request the newest native copy without waiting for the poll. */
export function refreshAnnotationClipboard() { return transport?.refresh?.().catch(()=>{}); }

/** Share a user copy, including pixels that otherwise only live in imageCache. */
export function shareAnnotationClipboard(annotations) {
  if (!channel) return;
  try {
    const payload=annotations.map(cloneAnnotation);
    for (const a of payload) {
      if (typeof a.imageData==='string' && a.imageData.startsWith('data:image/')) continue;
      const img=imageCache.get(a.imageId);
      if (!img?.complete || !img.naturalWidth) continue;
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0);a.imageData=canvas.toDataURL('image/png');
    }
    channel.publish(payload);
  } catch { /* an unavailable image/transport must not break local copying */ }
}
