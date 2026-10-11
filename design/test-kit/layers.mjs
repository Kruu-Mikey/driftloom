import { chromium } from 'playwright'; import path from 'path';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}, deviceScaleFactor:2})).newPage();
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(process.argv[2])); await p.evaluate(()=>document.fonts.ready);
await p.addStyleTag({content:'.masthead,section.handover,.spec,.section-title,.sim-toggle{display:none !important}'});
for (const th of ['t-dawn','t-ember','t-tidal','t-dark','t-nocturne','t-olive']) {
  const el=await p.$(`.${th} .dynamic-inner`); await el.scrollIntoViewIfNeeded(); await el.screenshot({path:`out/lay_${th}.png`});
}
// pressed icon button
const btn=await p.$('.t-dawn .row-2 .btn'); await btn.scrollIntoViewIfNeeded(); const bb=await btn.boundingBox();
const z=await p.$('.t-dawn .zone-buttons'); await p.mouse.move(bb.x+30,bb.y+30); await p.mouse.down(); await p.waitForTimeout(200); await z.screenshot({path:'out/press_dawn.png'}); await p.mouse.up();
const btn2=await p.$('.t-dark .row-3 .btn'); await btn2.scrollIntoViewIfNeeded(); const bb2=await btn2.boundingBox();
const z2=await p.$('.t-dark .zone-buttons'); await p.mouse.move(bb2.x+30,bb2.y+20); await p.mouse.down(); await p.waitForTimeout(200); await z2.screenshot({path:'out/press_dark.png'}); await p.mouse.up();
await b.close();
