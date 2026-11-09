// Goedkeuringsroutes (#651): het auditrecord van een aanvraag en de
// toestandsmachine erop. Puur (alleen Web Crypto), zodat het in Node te
// testen is.
//
// Een record is een onveranderlijke kop (versie, provider, id, tijdstip,
// configuratie) met een hashketen van gebeurtenissen. De toestand wordt
// steeds opnieuw afgeleid door de keten af te spelen (verifyRequest); er is
// geen opgeslagen status die los van de keten kan raken.
//
// Versie 1: de oorspronkelijke lokale bestandsoverdracht (local-file-v1),
// ontvangers zonder rol. Versie 2: rollen per ontvanger (beoordelen,
// goedkeuren, ondertekenen), een bericht, de bestandsgrootte van de
// verzonden versie (voor het herkennen van ondertekende kopieën), soorten
// velden, verzendingen (dispatch) en vervanging bij een gewijzigd document.
// Versie-1-records blijven precies zo geldig als ze waren.

export const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=object=>digest(new TextEncoder().encode(JSON.stringify(object)));
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=code=>{throw new Error(code);};
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Providers die een aanvraag kunnen overdragen (providers.js). */
export const PROVIDERS=['local-file-v1','mail-v1'];
/** Rollen van een ontvanger (versie 2). */
export const ROLES=['review','approve','sign'];
/** Soorten velden: een controlegebied, of een handtekening-/parafeervak voor een ondertekenaar. */
export const FIELD_KINDS=['review','signature','initials'];
/** Toestanden waarin een aanvraag nog loopt. */
export const OPEN_STATES=['draft','submitted','in_progress'];
const TERMINAL=['completed','rejected','expired','cancelled','superseded'];
/** Hoe een teruggekomen kopie aan de verzonden versie gekoppeld is. */
export const COPY_MATCHES=['exact','incremental','reference'];

/** Welke beslissingen bij een rol horen. */
export function decisionsFor(role){return role==='sign'?['signed','rejected']:['approved','rejected'];}

export function validateConfiguration(config,version=1){
 const v2=version===2;
 if(!config||!text(config.title,200)||!config.title.trim()||!['sequential','parallel'].includes(config.mode)||!text(config.source?.name,500)||!sha(config.source?.hash)||!Number.isInteger(config.source?.pages)||config.source.pages<1||!text(config.source?.revision,100))fail('INVALID_REQUEST');
 if(v2&&(!Number.isInteger(config.source.size)||config.source.size<1||!text(config.message,5000)))fail('INVALID_REQUEST');
 if(config.expiresAt!==null&&!date(config.expiresAt))fail('INVALID_EXPIRY');if(!Array.isArray(config.recipients)||!config.recipients.length||config.recipients.length>50)fail('INVALID_RECIPIENTS');
 const ids=new Set(),emails=new Set(),roles=new Map();
 const recipients=config.recipients.map(r=>{
  if(!text(r.id,100)||!r.id||ids.has(r.id)||!text(r.name,200)||!r.name.trim()||!text(r.email,254)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)||emails.has(r.email.toLowerCase()))fail('INVALID_RECIPIENT');
  if(v2&&!ROLES.includes(r.role))fail('INVALID_RECIPIENT');
  ids.add(r.id);emails.add(r.email.toLowerCase());roles.set(r.id,r.role);
  return v2?{id:r.id,name:r.name.trim(),email:r.email,role:r.role}:{id:r.id,name:r.name.trim(),email:r.email};
 });
 if(!Array.isArray(config.fields)||config.fields.length>500)fail('INVALID_FIELDS');const fieldIds=new Set();
 const fields=config.fields.map(f=>{
  if(!text(f.id,100)||!f.id||fieldIds.has(f.id)||!ids.has(f.recipientId)||!Number.isInteger(f.page)||f.page<1||f.page>config.source.pages||!text(f.label,200)||!f.label.trim()||![f.x,f.y,f.width,f.height].every(Number.isFinite)||f.x<0||f.y<0||f.width<=0||f.height<=0)fail('INVALID_FIELD');
  // Een handtekening- of parafeervak hoort alleen bij een ondertekenaar.
  if(v2&&(!FIELD_KINDS.includes(f.kind)||(f.kind!=='review'&&roles.get(f.recipientId)!=='sign')))fail('INVALID_FIELD');
  fieldIds.add(f.id);
  return v2?{id:f.id,recipientId:f.recipientId,kind:f.kind,page:f.page,x:f.x,y:f.y,width:f.width,height:f.height,label:f.label}:{id:f.id,recipientId:f.recipientId,page:f.page,x:f.x,y:f.y,width:f.width,height:f.height,label:f.label};
 });
 const source=v2?{name:config.source.name,hash:config.source.hash,pages:config.source.pages,revision:config.source.revision,size:config.source.size}:{name:config.source.name,hash:config.source.hash,pages:config.source.pages,revision:config.source.revision};
 return v2?{title:config.title.trim(),mode:config.mode,expiresAt:config.expiresAt,message:config.message,source,recipients,fields}:{title:config.title.trim(),mode:config.mode,expiresAt:config.expiresAt,source,recipients,fields};
}
const header=record=>({version:record.version,adapter:record.adapter,id:record.id,createdAt:record.createdAt,config:record.config});

/**
 * Een nieuw concept. Zonder opties een versie-1-record (local-file-v1), zoals
 * voorheen; de app maakt versie 2 met een gekozen provider.
 */
export async function createRequest(config,now=new Date().toISOString(),{version=1,adapter='local-file-v1',id=crypto.randomUUID()}={}){
 if(version===1&&adapter!=='local-file-v1'||version===2&&!PROVIDERS.includes(adapter)||![1,2].includes(version))fail('INVALID_REQUEST');
 if(!text(id,100)||!id)fail('INVALID_REQUEST');
 config=validateConfiguration(config,version);if(!date(now)||config.expiresAt&&Date.parse(config.expiresAt)<=Date.parse(now))fail('INVALID_EXPIRY');const record={...header({version,adapter,id,createdAt:now,config}),events:[]};record.root=await hash(header(record));return record;
}
function evidenceCheck(evidence,decision){
 if(!evidence||typeof evidence!=='object'||!['receipt-file','reply','copy'].includes(evidence.kind))return false;
 if(evidence.kind!=='copy')return evidence.copy===undefined&&decision!=='signed';
 const c=evidence.copy;return !!c&&sha(c.hash)&&Number.isInteger(c.size)&&c.size>0&&COPY_MATCHES.includes(c.match)&&text(c.name,500);
}
function receiptCheck(record,receipt){
 const recipient=record.config.recipients.find(r=>r.id===receipt?.recipientId);
 if(receipt?.version!==record.version||!text(receipt.id,100)||!receipt.id||receipt.requestId!==record.id||receipt.documentHash!==record.config.source.hash||!recipient||!date(receipt.at)||!text(receipt.comment,2000))fail('INVALID_RECEIPT');
 if(record.version===1){if(!['approved','rejected'].includes(receipt.decision))fail('INVALID_RECEIPT');return;}
 if(!decisionsFor(recipient.role).includes(receipt.decision)||!evidenceCheck(receipt.evidence,receipt.decision))fail('INVALID_RECEIPT');
}
const pendingRecipients=(record,state)=>record.config.recipients.filter(r=>!state.receipts.some(x=>x.recipientId===r.id));
/** Wie nu aan de beurt is: bij opeenvolgend de eerste zonder beslissing, parallel iedereen zonder. */
function turnOf(record,state){if(!OPEN_STATES.includes(state.status))return [];const open=pendingRecipients(record,state);return record.config.mode==='sequential'?open.slice(0,1):open;}
function applyEvent(record,state,event){
 const expired=record.config.expiresAt&&Date.parse(event.at)>=Date.parse(record.config.expiresAt);
 if(event.kind==='submit'){if(state.status!=='draft'||expired)fail('INVALID_TRANSITION');state.status='submitted';}
 else if(event.kind==='dispatch'){
  // Een verzending via de provider (versie 2): alleen naar wie aan de beurt is.
  const p=event.payload,turn=turnOf(record,state).map(r=>r.id);
  if(record.version!==2||!['submitted','in_progress'].includes(state.status)||expired)fail('REQUEST_CLOSED');
  if(p.provider!==record.adapter||!sha(p.attachmentHash)||!Array.isArray(p.recipients)||!p.recipients.length||p.recipients.some(id=>!turn.includes(id))||new Set(p.recipients).size!==p.recipients.length)fail('INVALID_DISPATCH');
  state.dispatches.push({at:event.at,recipients:copy(p.recipients),attachmentHash:p.attachmentHash});
 }
 else if(event.kind==='receipt'){
  const receipt=event.payload.receipt;receiptCheck(record,receipt);if(!['submitted','in_progress'].includes(state.status)||expired)fail('REQUEST_CLOSED');if(state.receipts.some(r=>r.id===receipt.id||r.recipientId===receipt.recipientId))fail('DUPLICATE_RECEIPT');
  const next=pendingRecipients(record,state)[0];if(record.config.mode==='sequential'&&next.id!==receipt.recipientId)fail('WAITING_FOR_PREVIOUS_RECIPIENT');state.receipts.push(copy(receipt));
  state.status=receipt.decision==='rejected'?'rejected':state.receipts.length===record.config.recipients.length?'completed':'in_progress';
 }else if(event.kind==='cancel'){if(TERMINAL.includes(state.status)||expired)fail('REQUEST_CLOSED');state.status='cancelled';}
 else if(event.kind==='supersede'){
  // Vervangen door een andere aanvraag, of (versie 2) doordat het document
  // na het voorbereiden is gewijzigd en opgeslagen.
  const p=event.payload,byReplacement=text(p.replacementId,100)&&!!p.replacementId&&p.replacementId!==record.id,byChange=record.version===2&&p.reason==='document-changed'&&p.replacementId===undefined;
  if(state.status==='superseded'||!(byReplacement||byChange))fail('INVALID_REPLACEMENT');state.status='superseded';if(byReplacement)state.replacementId=p.replacementId;else state.reason='document-changed';
 }
 else if(event.kind==='expire'){if(TERMINAL.includes(state.status)||!expired)fail('INVALID_EXPIRY');state.status='expired';}
 else fail('INVALID_EVENT');
}
/** De toestand per ontvanger: pending, approved, rejected, signed, expired, cancelled of superseded. */
function recipientStates(record,state){
 const turn=new Set(turnOf(record,state).map(r=>r.id));
 return record.config.recipients.map(r=>{
  const receipt=state.receipts.find(x=>x.recipientId===r.id),sent=state.dispatches.filter(d=>d.recipients.includes(r.id)).pop();
  // Zonder eigen beslissing volgt de ontvanger een afgesloten aanvraag; na
  // een afwijzing stopt de route en vervalt de vraag aan de rest.
  const status=receipt?receipt.decision:['expired','cancelled','superseded'].includes(state.status)?state.status:state.status==='rejected'?'cancelled':'pending';
  return {id:r.id,role:r.role||'approve',status,at:receipt?.at||null,turn:turn.has(r.id),dispatchedAt:sent?.at||null};
 });
}
export async function verifyRequest(input,now=new Date().toISOString()){
 if(![1,2].includes(input?.version)||(input.version===1?input.adapter!=='local-file-v1':!PROVIDERS.includes(input.adapter))||!text(input.id,100)||!input.id||!date(input.createdAt)||!Array.isArray(input.events)||input.events.length>200)fail('INVALID_AUDIT');
 const record=copy(input),config=validateConfiguration(record.config,record.version);if(JSON.stringify(config)!==JSON.stringify(record.config))fail('INVALID_CONFIGURATION');const root=await hash(header(record));if(root!==record.root)fail('AUDIT_ROOT_MISMATCH');
 let previous=root,lastAt=Date.parse(record.createdAt);const state={status:'draft',receipts:[],dispatches:[]};
 for(let seq=0;seq<record.events.length;seq++){
  const event=record.events[seq];if(event.seq!==seq||event.previous!==previous||!date(event.at)||Date.parse(event.at)<lastAt||!text(event.actor,300)||typeof event.payload!=='object'||event.payload===null)fail('INVALID_AUDIT_EVENT');
  const body={seq:event.seq,at:event.at,kind:event.kind,actor:event.actor,payload:event.payload,previous:event.previous};if(await hash(body)!==event.hash)fail('AUDIT_HASH_MISMATCH');applyEvent(record,state,event);previous=event.hash;lastAt=Date.parse(event.at);
 }
 if(OPEN_STATES.includes(state.status)&&record.config.expiresAt&&Date.parse(now)>=Date.parse(record.config.expiresAt))state.status='expired';
 const delivery=record.adapter==='mail-v1'?'mail-draft-handoff':'manual-file-handoff';
 return {...state,recipients:recipientStates(record,state),root,head:previous,integrity:true,identityVerified:false,delivery};
}
export async function appendEvent(input,kind,payload={},actor='Local operator',now=new Date().toISOString()){
 const state=await verifyRequest(input,now),record=copy(input);if(state.status==='expired'&&kind!=='expire'&&kind!=='supersede')fail('REQUEST_EXPIRED');
 const event={seq:record.events.length,at:now,kind,actor,payload:copy(payload),previous:state.head};event.hash=await hash(event);record.events.push(event);await verifyRequest(record,now);return record;
}
export async function recordReceipt(input,receipt,now=new Date().toISOString(),actor='Local operator (reported receipt)'){
 receiptCheck(input,receipt);await verifyRequest(input,now);const existing=input.events.find(e=>e.kind==='receipt'&&e.payload.receipt.id===receipt.id);if(existing){if(JSON.stringify(existing.payload.receipt)!==JSON.stringify(receipt))fail('RECEIPT_ID_CONFLICT');return copy(input);}
 return appendEvent(input,'receipt',{receipt},actor,now);
}
/** Een ontvanger meldt zijn beslissing over het ontvangen pakket (lokale bestandsoverdracht). */
export async function makeReceipt(record,bytes,recipientId,decision,comment='',now=new Date().toISOString()){
 const state=await verifyRequest(record,now);if(!['submitted','in_progress'].includes(state.status))fail('REQUEST_CLOSED');if(await digest(bytes)!==record.config.source.hash)fail('DOCUMENT_HASH_MISMATCH');
 const receipt={version:record.version,id:crypto.randomUUID(),requestId:record.id,documentHash:record.config.source.hash,recipientId,decision,at:now,comment};
 if(record.version===2)receipt.evidence={kind:'receipt-file'};
 receiptCheck(record,receipt);
 // Validate route eligibility, but do not mutate the sender's request.
 await recordReceipt(record,receipt,now);return receipt;
}
/**
 * De aanvrager legt een gemelde beslissing vast (versie 2): een antwoord per
 * mail ({kind:'reply'}) of een teruggekomen kopie ({kind:'copy', copy}).
 */
export function ownerReceipt(record,{recipientId,decision,comment='',evidence},now=new Date().toISOString()){
 if(record?.version!==2)fail('INVALID_RECEIPT');
 const receipt={version:2,id:crypto.randomUUID(),requestId:record.id,documentHash:record.config.source.hash,recipientId,decision,at:now,comment,evidence:copy(evidence)};
 receiptCheck(record,receipt);return receipt;
}

/** Korte, leesbare verwijzing naar een aanvraag, voor onderwerp en bestandsnaam: REQ-1A2B3C4D. */
export const requestRef=id=>'REQ-'+String(id).replace(/[^a-f0-9]/gi,'').slice(0,8).toUpperCase();
/** Alle aanvraagverwijzingen in een tekst (bestandsnaam, onderwerp). */
export const refsInText=value=>[...new Set((String(value||'').match(/REQ-[A-F0-9]{8}/gi)||[]).map(s=>s.toUpperCase()))];

/**
 * Hoort deze teruggekomen kopie bij de verzonden versie?
 *  - exact       : precies dezelfde bytes (een ongewijzigd teruggestuurd document)
 *  - incremental : de verzonden bytes, met een incrementele toevoeging erachter
 *                  (zoals een certificaathandtekening of opmerkingen die
 *                  zonder herschrijven zijn toegevoegd)
 *  - null        : de inhoud is niet aan de verzonden versie te koppelen
 */
export async function matchCopy(record,bytes){
 const src=record.config.source,h=await digest(bytes),size=bytes.length;
 if(h===src.hash)return {match:'exact',hash:h,size};
 if(Number.isInteger(src.size)&&size>src.size&&await digest(bytes.subarray(0,src.size))===src.hash)return {match:'incremental',hash:h,size};
 return {match:null,hash:h,size};
}
/**
 * Bij welke aanvragen past een teruggekomen bestand? Eerst op inhoud
 * (hash), daarna alleen op de aanvraagverwijzing in de bestandsnaam; die
 * laatste is niet aan de inhoud te controleren.
 */
export async function findCopyMatches(records,bytes,name=''){
 const refs=refsInText(name),out=[];
 for(const record of records){const m=await matchCopy(record,bytes);if(m.match)out.push({id:record.id,...m});else if(refs.includes(requestRef(record.id)))out.push({id:record.id,...m,match:'reference'});}
 return out.sort((a,b)=>COPY_MATCHES.indexOf(a.match)-COPY_MATCHES.indexOf(b.match));
}
