import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const [,,file,out,themes='t-dawn,t-dark']=process.argv;
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}, deviceScaleFactor:2})).newPage();
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(file)); await p.evaluate(()=>document.fonts.ready);
await p.addStyleTag({content:'.masthead,section.handover,.spec,.section-title,.sim-toggle{display:none !important}'});
fs.mkdirSync(out,{recursive:true});
for (const th of themes.split(',')) for (const pct of ['100','130','200']) {
  await p.evaluate(v=>{document.documentElement.style.fontSize=v+'%'; fitAll();}, pct);
  const el=await p.$(`.${th} .info-inner`); await el.scrollIntoViewIfNeeded();
  const n=await p.evaluate(th=>{const m=document.querySelector('.'+th+' .meta'); return m.classList.contains('rot-all')?4:m.classList.contains('rot')?2:1;}, th);
  for (let k=0;k<n;k++){ await el.screenshot({path:`${out}/${th}_${pct}_p${k}.png`}); await p.evaluate(th=>turnPage(document.querySelector('.'+th)), th); }
}
await b.close();
