const { chromium } = require('./node_modules/playwright');
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages.find(p=>p.url().includes('localhost:3041')&&!p.url().includes('worker'))||pages[0];
  const info = await page.evaluate(()=>{
    const c = document.getElementById('annotation-canvas');
    const pdf = document.getElementById('pdf-canvas');
    const cont = document.getElementById('pdf-container');
    const r = c?.getBoundingClientRect();
    const r2 = pdf?.getBoundingClientRect();
    const r3 = cont?.getBoundingClientRect();
    return {
      annot: r?{x:r.x,y:r.y,w:r.width,h:r.height}:null,
      pdf: r2?{x:r2.x,y:r2.y,w:r2.width,h:r2.height}:null,
      cont: r3?{x:r3.x,y:r3.y,w:r3.width,h:r3.height}:null,
      vp: { cw: window.innerWidth, ch: window.innerHeight, scrollY: cont?.scrollTop, scrollX: cont?.scrollLeft },
      pe: c ? getComputedStyle(c).pointerEvents : null,
      tool: window.__OPDFS?.state?.currentTool,
      activePage: window.__pdfViewport?.pageNum,
      pageMode: window.__OPDFS?.state?.pageDisplayMode,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
