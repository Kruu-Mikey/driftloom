import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const file=process.argv[2]; const shot=process.argv[3]||'';
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1500,height:1000}}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error') errs.push(m.text());});
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(file)); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
for (const v of ['100','130','150','200']) {
  await p.click(`input[name="text-size"][value="${v}"]`); await p.waitForTimeout(150);
  console.log(v, '->', await p.textContent('#audit'));
  if (shot) { fs.mkdirSync(shot,{recursive:true}); const ph=await p.$$('.phone'); for (let i=0;i<9;i++) await ph[i].screenshot({path:`${shot}/p${i+1}_${v}.png`}); }
}
console.log('console/page errors:', errs.length? errs : 'none');
await b.close();
