// Passive, bounded render observations. Absence of warnings is NOT a fidelity
// certificate. No engine-global console interception or PDF content is stored.
const documents = new Map();
const listeners = new Set();
const notify = () => { for (const fn of listeners) { try {fn();} catch {} } };
const get = path => {
  if(!documents.has(path)) {
    if(documents.size>=128) documents.delete(documents.keys().next().value);
    documents.set(path,{pages:new Map()});
  }
  return documents.get(path);
};
export function subscribeRenderDiagnostics(fn) {listeners.add(fn);return ()=>listeners.delete(fn);}
export function beginRenderObservation(path,page,backend,quality='unknown') {
  if(!path || !Number.isInteger(page) || page<1) return null;
  const doc=get(path);
  if(!doc.pages.has(page)) {
    if(doc.pages.size>=1024)doc.pages.delete(doc.pages.keys().next().value);
    doc.pages.set(page,{findings:[],quality,backend,status:'unknown'});
  }
  return {path,page,backend,quality,doc,entry:doc.pages.get(page)};
}
export function reportRenderObservation(token,{code='RENDER_RETURNED',status='unknown',severity='info'}={}) {
  if(!token || documents.get(token.path)!==token.doc || token.doc.pages.get(token.page)!==token.entry)return;
  const entry=token.entry;
  const finding={page:token.page,backend:token.backend,quality:token.quality,code,status,severity};
  let added=false;
  if(code!=='RENDER_RETURNED' && !entry.findings.some(f=>f.code===code&&f.backend===token.backend&&f.quality===token.quality)) {
    if(entry.findings.length>=16)entry.findings.shift();entry.findings.push(finding);added=true;
  }
  entry.backend=token.backend;entry.quality=token.quality;entry.status=status;
  // Alleen een nieuwe bevinding verandert wat de statusbalk toont; elke
  // geslaagde tegel melden zou de statusbalk bij iedere render herberekenen.
  if(added)notify();
}
export function readRenderDiagnostics(path) {
  const doc=documents.get(path);
  return {fidelity:'not-certified',coverage:'observed native render requests only; silent omissions and browser decoders may not report errors',
    pages:doc?Array.from(doc.pages,([page,e])=>({page,backend:e.backend,quality:e.quality,status:e.status,findings:e.findings.map(f=>({...f}))})).sort((a,b)=>a.page-b.page):[]};
}
export function invalidateRenderDiagnostics(path,page) {
  if(path===undefined)documents.clear();
  else if(page===undefined)documents.delete(path);
  else documents.get(path)?.pages.delete(page);
  notify();
}
const commands = new Map([['render_pdf_page','pdfium'],['render_pdf_page_region','pdfium'],['render_pdf_page_skia','rust-skia']]);
export function isObservedRenderCommand(cmd){return commands.has(cmd);}
export async function observeNativeRender(cmd,args,run) {
  const token=beginRenderObservation(args.path,Number(args.pageIndex)+1,commands.get(cmd),'unknown');
  try {
    const result=await run();
    const bytes=result instanceof Uint8Array?result:result instanceof ArrayBuffer?new Uint8Array(result):Array.isArray(result)?new Uint8Array(result):null;
    if(!bytes || bytes.byteLength<8)throw new Error('PDF_INVALID_RENDER_BUFFER');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const width=view.getUint32(0,true),height=view.getUint32(4,true);
    if(!width||!height||!Number.isSafeInteger(width*height*4)||bytes.byteLength!==8+width*height*4)throw new Error('PDF_INVALID_RENDER_BUFFER');
    reportRenderObservation(token);
    return result;
  } catch(error) {
    const message=String(error?.message||error);
    const resourceCode=['PDF_RENDER_TIMEOUT','PDF_WORKER_RESPONSE_LIMIT','PDF_WORKER_UNAVAILABLE'].find(code=>message.includes(code));
    const code=resourceCode || (message.includes('PDF_OUTPUT_LIMIT')||message.includes('bitmap too large')?'PDF_OUTPUT_LIMIT':
      message.includes('PDF_INVALID_GEOMETRY')?'PDF_INVALID_GEOMETRY':message.includes('PDF_INVALID_RENDER_BUFFER')?'PDF_INVALID_RENDER_BUFFER':'RENDER_FAILED');
    reportRenderObservation(token,{code,status:'failed',severity:'warning'});
    throw error;
  }
}
