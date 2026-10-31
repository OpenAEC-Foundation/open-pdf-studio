import { createSignal, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { openPortfolioSession, writePortfolioCopy } from '../../../pdf/portfolio-service.js';
import { isTauri, saveFileDialog, writeDownloadedFileNew, bewaarPdfOpSite } from '../../../core/platform.js';
export default function PortfolioDialog() {
  const {t}=useTranslation('dialogs'), documentId=getActiveDocument()?.id;
  const [model,setModel]=createSignal(null),[busy,setBusy]=createSignal(false),[error,setError]=createSignal(''),[selected,setSelected]=createSignal(''),[folder,setFolder]=createSignal(''),[folderName,setFolderName]=createSignal(''),[description,setDescription]=createSignal('');
  let session;
  const close=()=>closeDialog('portfolio');
  const run=async action=>{setBusy(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}};
  onMount(()=>run(async()=>{session=await openPortfolioSession(documentId);setModel(session.inspect());}));
  const change=async edits=>{setModel(await session.change(edits));};
  const path=f=>{ const parts=[f.name];let parent=f.parentId;while(parent!==null){const p=model().folders.find(x=>x.id===parent);if(!p)break;parts.unshift(p.name);parent=p.parentId;}return parts.join(' / '); };
  const item=()=>model()?.items.find(x=>x.key===selected());
  const download=(bytes,name,type='application/octet-stream')=>{const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/\x00-\x1f]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const exportComponent=()=>run(async()=>{const entry=item();if(!entry)return;const bytes=session.extract(entry.key);if(isTauri()){const target=await saveFileDialog(entry.name,[]);if(!target)return;session.check();await writeDownloadedFileNew(target,bytes,{restrict:false});}else download(bytes,entry.name);});
  const preview=()=>run(async()=>{const entry=item();if(!entry)return;const bytes=session.extract(entry.key);if(new TextDecoder('ascii').decode(bytes.subarray(0,1024)).indexOf('%PDF-')<0)throw new Error('PDF_PREVIEW_ONLY');const {openPortfolioPreview}=await import('../../../pdf/portfolio-preview.js');session.check();await openPortfolioPreview(bytes,entry.name);close();});
  const save=()=>run(async()=>{await change({});if(isTauri()){const target=await saveFileDialog('collection.pdf',[{name:'PDF',extensions:['pdf']}]);if(target)await writePortfolioCopy(session,target);}else if((await bewaarPdfOpSite('collection.pdf',session.bytes()))===null)download(session.bytes(),'collection.pdf','application/pdf');});
  return <Dialog title={t('portfolio.title')} dialogClass="portfolio-dialog" onClose={close} footer={<><button class="pref-btn pref-btn-secondary" disabled={busy()||!model()} onClick={save}>{t('portfolio.save')}</button><button class="pref-btn pref-btn-secondary" onClick={close}>{t('portfolio.close')}</button></>}>
    <p>{t('portfolio.info')}</p>
    <Show when={error()}><p role="alert">{t(`portfolio.errors.${error()}`,{defaultValue:error()})}</p></Show>
    <Show when={model()}><div class="portfolio-controls">
      <label>{t('portfolio.folder')}<select disabled={busy()} value={folder()} onChange={e=>setFolder(e.currentTarget.value)}><option value="" selected={folder()===''}>{t('portfolio.root')}</option><For each={model().folders}>{f=><option value={f.id} selected={folder()===String(f.id)}>{path(f)}</option>}</For></select></label>
      <label>{t('portfolio.newFolder')}<input value={folderName()} onInput={e=>setFolderName(e.currentTarget.value)}/></label>
      <button class="pref-btn pref-btn-secondary" disabled={busy()||!folderName().trim()} onClick={()=>run(async()=>{await change({folders:[{name:folderName(),parentId:folder()===''?(model().folders[0]?.id??0):Number(folder())}]});setFolderName('');})}>{t('portfolio.addFolder')}</button>
      <label>{t('portfolio.add')}<input type="file" multiple disabled={busy()} onChange={e=>{const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value='';run(async()=>{const add=[];for(const f of files)add.push({name:f.name,mime:f.type,bytes:new Uint8Array(await f.arrayBuffer()),folderId:folder()===''?null:Number(folder())});await change({add});});}}/></label>
    </div>
    <table class="portfolio-table"><thead><tr><th>{t('portfolio.name')}</th><th>{t('portfolio.folder')}</th><th>{t('portfolio.description')}</th></tr></thead><tbody><For each={model().items}>{entry=><tr aria-selected={selected()===entry.key}><td><button class="pref-btn pref-btn-secondary" disabled={busy()} onClick={()=>{setSelected(entry.key);setDescription(entry.description);}}>{entry.name}</button></td><td>{path(model().folders.find(f=>f.id===entry.folderId)||{name:t('portfolio.root'),parentId:null})}</td><td>{entry.description}</td></tr>}</For></tbody></table>
    <Show when={item()}><div class="portfolio-controls"><label>{t('portfolio.description')}<input value={description()} onInput={e=>setDescription(e.currentTarget.value)}/></label><button class="pref-btn pref-btn-secondary" disabled={busy()} onClick={()=>run(()=>change({descriptions:[{key:selected(),description:description()}]}))}>{t('portfolio.update')}</button><button class="pref-btn pref-btn-secondary" disabled={busy()} onClick={exportComponent}>{t('portfolio.export')}</button><button class="pref-btn pref-btn-secondary" disabled={busy()||!item()?.name.toLowerCase().endsWith('.pdf')} onClick={preview}>{t('portfolio.preview')}</button><button class="pref-btn pref-btn-secondary" disabled={busy()} onClick={()=>run(async()=>{await change({remove:[selected()]});setSelected('');})}>{t('portfolio.remove')}</button><pre>{JSON.stringify(item().metadata,null,2)}</pre></div></Show>
    <details><summary>{t('portfolio.schema')}</summary><pre>{JSON.stringify({schema:model().schema,sort:model().sort},null,2)}</pre></details></Show>
  </Dialog>;
}
