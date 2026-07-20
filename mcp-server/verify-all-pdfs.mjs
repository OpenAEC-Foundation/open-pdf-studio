// Verplichte all-PDF rig-test: opent elk verificatiebestand en controleert dat
// p1 en een middenpagina renderen (niet blanco). Meet ook de route (engine).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');
const fs = require('fs');
const MCP = 'http://127.0.0.1:9223/mcp';
const DIR = 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden';
async function tool(name, args) { const r = await fetch(MCP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method:'tools/call',params:{name,arguments:args}})}); const j=await r.json(); const t=j?.result?.content?.[0]?.text; try{return JSON.parse(t);}catch{return t;} }
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async () => {
  const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const ink = () => page.evaluate(() => { const c=document.getElementById('pdf-canvas'); if(!c||!c.width)return{i:0}; const x=c.getContext('2d'); let d; try{d=x.getImageData(0,0,c.width,c.height).data;}catch(e){return{i:-1};} let n=0,t=0; for(let k=0;k<d.length;k+=4*17){t++;if(d[k+3]>0&&!(d[k]>245&&d[k+1]>245&&d[k+2]>245))n++;} return {i:+(100*n/t).toFixed(1)}; });
  const numPages = () => page.evaluate(async()=>{const s=await import('/js/core/state.ts');return s.state.documents[s.state.activeDocumentIndex]?.pdfDoc?.numPages||0;});
  // render-wacht: poll tot ink>2 of timeout
  const waitInk = async (max=14) => { let best=0; for(let i=0;i<max;i++){ await sleep(1400); const w=await ink(); if(w.i>best)best=w.i; if(w.i>2.5)break; } return best; };

  console.log(`${files.length} bestanden\n`);
  let okCount=0, fails=[];
  for (const f of files) {
    const path = `${DIR}/${f}`;
    await tool('app_clear_caches', {}); await sleep(300);
    await tool('app_open_pdf', { path });
    let pc=0; for(let i=0;i<50&&!pc;i++){ await sleep(600); pc=await numPages(); }
    if (!pc) { console.log(`OPEN-FAIL  ${f.slice(0,42)}`); fails.push(f+' (open)'); continue; }
    const p1 = await waitInk();
    // middenpagina
    const mid = Math.max(1, Math.ceil(pc/2));
    await tool('app_go_to_page', { page: mid });
    const pm = await waitInk();
    const ok = p1>2 && pm>2;
    console.log(`${ok?'OK  ':'BLANK'}  ${f.slice(0,44).padEnd(44)} pages=${String(pc).padStart(2)} p1=${p1}% p${mid}=${pm}%`);
    if (ok) okCount++; else fails.push(`${f} (p1=${p1}% p${mid}=${pm}%)`);
  }
  console.log(`\n${okCount}/${files.length} renderen. ${fails.length?'FAILS:\n  '+fails.join('\n  '):'ALLE OK'}`);
  await browser.close(); process.exit(fails.length?1:0);
})();
