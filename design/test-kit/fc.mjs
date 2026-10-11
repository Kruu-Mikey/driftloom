import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const [,,file,out,scheme='dark']=process.argv;
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}, colorScheme:scheme})).newPage();
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.emulateMedia({forcedColors:'active', colorScheme:scheme});
await p.goto('file://'+path.resolve(file)); await p.evaluate(()=>document.fonts.ready);
console.log('forced-colors matches:', await p.evaluate(()=>matchMedia('(forced-colors: active)').matches));
await p.keyboard.press('Shift'); await p.focus('.t-dawn .row-2 .btn');
const ph=await p.$$('.phone'); await ph[0].screenshot({path:out+'_p1.png'}); await ph[4].screenshot({path:out+'_p5.png'});
// probes: dot visible? compare centre of an .on note and an empty dot vs the panel next to it
const probe=await p.evaluate(()=>{const q=s=>document.querySelector(s); const cs=e=>getComputedStyle(e);
  const on=q('.t-dawn .layer:nth-child(2) .pattern span.on'), off=q('.t-dawn .layer:nth-child(2) .pattern span:not(.on)'), ph=q('.t-dawn .playhead i.on');
  return {onBg:cs(on).backgroundColor, offBg:cs(off).backgroundColor, halo:cs(q('.t-dawn .layer:nth-child(2) .pattern span:nth-child(9)')).boxShadow, playheadOn:cs(ph,'::after').backgroundColor, playheadCell:cs(q('.t-dawn .playhead i')).backgroundColor, btnBorder:cs(q('.t-dawn .row-2 .btn')).borderColor, panelBorder:cs(q('.t-dawn .dynamic-inner')).borderStyle+' '+cs(q('.t-dawn .dynamic-inner')).borderColor, focus:cs(q('.t-dawn .row-2 .btn')).outline};});
console.log(JSON.stringify(probe,null,1));
await b.close();
