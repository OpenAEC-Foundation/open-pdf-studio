import { PDFDocument, PDFDict, PDFArray, PDFRef, PDFName, PDFRawStream, PDFBool } from 'pdf-lib';
import { scanRemovedClasses } from './hidden-information-scan.js';

const N=PDFName.of;
const name=v=>v instanceof PDFName?v.decodeText():'';
const dict=v=>v instanceof PDFRawStream?v.dict:v instanceof PDFDict?v:null;
const CATEGORIES=['metadata','comments','attachments','actions'];
// Keys this app stores for itself (OCR review text, layer and scale data).
const privateKeys=d=>d.keys().map(k=>k.decodeText()).filter(k=>k.startsWith('OPS_'));
function walk(pdf,visit) {
  const seen=new Set();
  const stack=[{value:pdf.context.trailerInfo.Root || pdf.context.getObjectRef(pdf.catalog),path:'Catalog'},{value:pdf.context.trailerInfo.Info,path:'Info'}];
  while(stack.length){
    let {value,path}=stack.pop();
    if(value instanceof PDFRef){if(seen.has(value.toString()))continue;seen.add(value.toString());value=pdf.context.lookup(value);}
    if(!value)continue;
    visit(value,path);
    const d=dict(value);
    if(d)for(const [key,child] of d.entries()) stack.push({value:child,path:path+'/'+key.decodeText()});
    else if(value instanceof PDFArray)for(let i=0;i<value.size();i++)stack.push({value:value.get(i),path:path+'/'+i});
  }
  return seen;
}
function inventory(pdf) {
  const findings=[];
  const add=(category,path,detail,removable=true)=>findings.push({category,path,detail,removable});
  if(pdf.context.trailerInfo.Info)add('metadata','Info','Document information dictionary');
  walk(pdf,(v,path)=>{
    const d=dict(v);if(!d)return;
    const type=name(d.get(N('Type'))),subtype=name(d.get(N('Subtype')));
    if(d.has(N('Metadata')))add('metadata',path+'/Metadata','XMP metadata stream');
    if(d.has(N('PieceInfo')))add('metadata',path+'/PieceInfo','Private application data');
    if(d.has(N('Thumb')))add('metadata',path+'/Thumb','Page thumbnail image');
    for(const key of privateKeys(d))add('metadata',path+'/'+key,'Private application data: '+key);
    if((type==='Annot'||(subtype&&d.has(N('Rect'))))&&subtype!=='Widget')add('comments',path,'Annotation: '+subtype);
    if(type==='EmbeddedFile'||d.has(N('EF')))add('attachments',path,'Embedded file');
    if(['A','AA','OpenAction','JavaScript'].some(k=>d.has(N(k)))||d.has(N('JS')))
      add('actions',path,'Document, page, field or annotation actions (including navigation)');
    if(d.has(N('XFA')))add('actions',path+'/XFA','XFA form packets, including scripts and form data');
    if(type==='OCG'||type==='OCMD'||d.has(N('OCProperties')))add('hiddenContent',path,'Optional content/layers; visibility-dependent content is not removed',false);
    if(type==='Sig'||name(d.get(N('FT')))==='Sig')add('signatures',path,'Rewriting changes signed bytes; existing signatures will not validate',false);
    if(d.has(N('OutputIntents')))add('conformance',path,'Output intent present; no PDF/A or PDF/X conformance is certified',false);
  });
  const reachable=walk(pdf,()=>{});
  const unreachable=pdf.context.enumerateIndirectObjects().filter(([ref])=>!reachable.has(ref.toString())).length;
  return {findings,unreachableObjects:unreachable,limitations:[
    'Inspection covers structural metadata, thumbnails, private application keys, annotations, embedded files, actions, XFA forms and optional-content dictionaries.',
    'Invisible text, clipped/covered page content, image pixels and arbitrary application-private streams are not classified or removed.',
    'Removing comments removes non-widget annotations, including visible markups and links, and their structure-tree references. Removing actions also disables navigation and form actions and drops XFA forms; AcroForm fields remain and are flagged to regenerate their appearances.',
    'Removing metadata also drops page thumbnails and private keys of this application, such as OCR review text, layers and scale settings.',
    'A rewritten copy cannot preserve existing digital signatures. Conformance requires independent validation.',
  ]};
}
export async function inspectHiddenInformation(bytes) {
  const pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
  return inventory(pdf);
}
/** Delete every object that is not reachable from the trailer; returns the count. */
export function sweepUnreachable(pdf) { return sweep(pdf); }
function sweep(pdf) {
  const reachable=walk(pdf,()=>{});let count=0;
  for(const [ref] of pdf.context.enumerateIndirectObjects())if(!reachable.has(ref.toString())){pdf.context.delete(ref);count++;}
  return count;
}
// Structure trees (OBJR /Obj), popups (/Parent) and replies (/IRT) point at
// annotations; drop those pointers so nothing references a removed annotation.
function purgeReferences(pdf,objects,removed){
  const gone=v=>{
    if(v instanceof PDFRef&&removed.has(v.toString()))return true;
    const d=dict(pdf.context.lookup(v));
    const obj=d&&name(d.get(N('Type')))==='OBJR'?d.get(N('Obj')):null;
    return obj instanceof PDFRef&&removed.has(obj.toString());
  };
  for(const v of objects){
    const d=dict(v);
    if(d){for(const [key,value] of d.entries())if(gone(value))d.delete(key);}
    else if(v instanceof PDFArray){for(let i=v.size()-1;i>=0;i--)if(gone(v.get(i)))v.remove(i);}
  }
}
/**
 * Drop every pointer to the given annotations (refs as strings): /Annots
 * entries, popups, replies and structure-tree OBJR references.
 */
export function purgeAnnotationReferences(pdf,removed){
  if(!removed.size)return;
  const objects=[];walk(pdf,(v)=>objects.push(v));
  purgeReferences(pdf,objects,removed);
}
export async function removeHiddenInformation(bytes, categories) {
  if(!Array.isArray(categories)||!categories.length||categories.some(c=>!CATEGORIES.includes(c)))throw new Error('INVALID_REMOVAL_CATEGORIES');
  const selected=new Set(categories);
  const pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
  const before=inventory(pdf);
  const attachmentRefs=new Set();
  if(selected.has('attachments')){
    for(const [ref,v]of pdf.context.enumerateIndirectObjects()){
      const d=dict(v);
      if(d&&(name(d.get(N('Type')))==='EmbeddedFile'||d.has(N('EF'))))attachmentRefs.add(ref.toString());
    }
  }
  // Traverse a snapshot before unlinking, so every still-reachable owner is processed.
  const objects=[];walk(pdf,(v)=>objects.push(v));
  if(selected.has('metadata')) { delete pdf.context.trailerInfo.Info; delete pdf.context.trailerInfo.ID; }
  const removedAnnots=new Set();
  for(const v of objects){
    const d=dict(v);
    if(d){
      if(selected.has('metadata')){
        for(const key of ['Metadata','PieceInfo','Thumb'])d.delete(N(key));
        for(const key of privateKeys(d))d.delete(N(key));
      }
      if(selected.has('actions')){
        for(const key of ['A','AA','OpenAction','JavaScript','JS'])d.delete(N(key));
        // XFA packets carry scripts and form data. Without them the AcroForm
        // fields are the form; their appearances are regenerated on open.
        if(d.has(N('XFA'))){d.delete(N('XFA'));if(d.has(N('Fields')))d.set(N('NeedAppearances'),PDFBool.True);}
        if(d.has(N('NeedsRendering')))d.delete(N('NeedsRendering'));
      }
      if(selected.has('attachments'))for(const key of ['EmbeddedFiles','AF','EF'])d.delete(N(key));
      const annots=pdf.context.lookup(d.get(N('Annots')));
      if(annots instanceof PDFArray){
        for(let i=annots.size()-1;i>=0;i--){
          const raw=annots.get(i),a=pdf.context.lookup(raw);const ad=dict(a);
          const subtype=ad&&name(ad.get(N('Subtype')));
          if((selected.has('comments')&&subtype&&subtype!=='Widget')||(selected.has('attachments')&&subtype==='FileAttachment')){
            annots.remove(i);if(raw instanceof PDFRef)removedAnnots.add(raw.toString());
          }
        }
      }
      if(selected.has('attachments'))for(const [key,value]of d.entries()){
        if(value instanceof PDFRef&&attachmentRefs.has(value.toString()))d.delete(key);
      }
    } else if(v instanceof PDFArray && selected.has('attachments')){
      for(let i=v.size()-1;i>=0;i--){const value=v.get(i);if(value instanceof PDFRef&&attachmentRefs.has(value.toString()))v.remove(i);}
    }
  }
  if(removedAnnots.size)purgeReferences(pdf,objects,removedAnnots);
  const removedUnreachableObjects=sweep(pdf);
  const output=await pdf.save({useObjectStreams:false,updateFieldAppearances:false});
  // Verification does not reuse the detector: it parses the written bytes on
  // its own and checks every object in the file for the removed key classes.
  const remaining=scanRemovedClasses(output,[...selected]);
  if(remaining.length)throw Object.assign(new Error('REMOVAL_VERIFICATION_FAILED'),{remaining});
  const after=await inspectHiddenInformation(output);
  return {bytes:output,report:{selected:[...selected],before,after,removedUnreachableObjects,verified:true,
    verification:'Parsed the written bytes independently and found no remaining object of the removed classes and no unreferenced objects; this is not an all-content sanitization guarantee.'}};
}
