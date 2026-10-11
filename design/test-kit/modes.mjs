import { chromium } from 'playwright'; import path from 'path';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(process.argv[2])); await p.evaluate(()=>document.fonts.ready);
const out=[]; let last='';
for (let s=100;s<=200;s+=2){ const m=await p.evaluate(v=>{document.documentElement.style.fontSize=v+'%'; fitAll(); const c=document.querySelector('.meta').className; return (c.match(/rot-\w+/)||['still'])[0];}, s); if(m!==last){out.push(s+'%: '+m); last=m;} }
console.log(out.join(' | ')); await b.close();
