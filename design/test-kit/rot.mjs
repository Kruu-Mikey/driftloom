import { chromium } from 'playwright'; import path from 'path';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(process.argv[2])); await p.evaluate(()=>document.fonts.ready);
await p.addStyleTag({content:'.masthead,section.handover,.spec,.section-title{display:none !important}'});
const shown=()=>p.evaluate(()=>[...document.querySelectorAll('.t-dawn .meta > *')].filter(l=>getComputedStyle(l).opacity!=='0').map(l=>l.className.split(' ')[0].replace('m-','')).join('+'));
const btnState=()=>p.evaluate(()=>{const b=document.querySelector('.t-dawn .info-next'); return b.hidden?'hidden':'shown';});
console.log('100%: next button', await btnState(), '| lines', await shown());
await p.check('input[name="text-size"][value="200"]'); await p.waitForTimeout(100);
console.log('200%: next button', await btnState(), '| page0', await shown());
const t0=Date.now(); const seen=[await shown()];
await p.mouse.move(5,5);
for (let i=0;i<9;i++){ await p.waitForTimeout(1000); seen.push(await shown()); }
console.log('playing, 10s, sampled each second:', seen.join(' | '));
// hover hold
const card=await p.$('.t-dawn .info-inner'); await card.scrollIntoViewIfNeeded(); await card.hover(); const h0=await shown(); await p.waitForTimeout(6000); console.log('hover 6s: before', h0, 'after', await shown(), h0===await shown()?'(held)':'(MOVED)');
await card.click(); const tp=await shown(); console.log('tap ->', tp); await p.mouse.move(5,5); await p.waitForTimeout(6000); console.log('after tap, 6s playing:', tp===await shown()?'stays (manual)':'MOVED'); await p.click('.t-dawn .row-1 .btn:last-child'); await p.waitForTimeout(4600); console.log('after Next + 4.6s:', await shown(), '(auto resumed if it changed from page0)');
await p.mouse.move(5,5);
// focus hold
await p.focus('.t-dawn .info-next'); const f0=await shown(); await p.waitForTimeout(6000); console.log('focus 6s:', f0===await shown()?'held':'MOVED');
await p.keyboard.press('Enter'); const f1=await shown(); console.log('Enter ->', f1, f1!==f0?'(turned)':'(no change)');
await p.keyboard.press('Space'); console.log('Space ->', await shown());
await p.evaluate(()=>document.activeElement.blur());
// pause stops it
await p.click('.t-dawn .btn-play'); const pz=await shown(); await p.mouse.move(5,5); await p.waitForTimeout(6000); console.log('paused 6s:', pz===await shown()?'held':'MOVED', '| playhead label:', await p.evaluate(()=>document.querySelector('.t-dawn .playhead').getAttribute('aria-label')));
await p.click('.t-dawn .btn-play');
console.log('aria (200%):\n'+(await p.locator('.t-dawn .info-inner').ariaSnapshot()));
const cover=await p.evaluate(()=>{const n=document.querySelector('.t-dawn .name').getBoundingClientRect(); const e=document.elementFromPoint(n.x+5,n.y+5); return e.className;}); console.log('element under the name:', cover);
  const tabs=await p.evaluate(()=>[...document.querySelectorAll('.t-dawn button')].filter(b=>!b.hidden).length);
console.log('focusable buttons in Dawn at 200%:', tabs);
await p.check('input[name="text-size"][value="100"]'); await p.waitForTimeout(100);
console.log('back to 100%: next button', await btnState(), '| lines', await shown());
console.log('errors', errs.length?errs:'none'); await b.close();
