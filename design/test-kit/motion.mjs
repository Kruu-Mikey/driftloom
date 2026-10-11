import { chromium } from 'playwright'; import path from 'path';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.route('**/*', r=>r.request().url().startsWith('file://')?r.continue():r.abort());
await p.goto('file://'+path.resolve(process.argv[2])); if(process.env.SHALLOW) await p.addStyleTag({content:'.masthead,section.handover,.spec,.section-title{display:none !important}'});
async function press(sel){ const el=await p.$(sel); await el.scrollIntoViewIfNeeded(); const bb=await el.boundingBox(); await p.mouse.move(bb.x+bb.width*0.3,bb.y+bb.height*0.3); await p.mouse.down(); await p.waitForTimeout(150);
  const st=await el.evaluate(e=>{const c=getComputedStyle(e);return `transform=${c.transform} filter=${c.filter} transition=${c.transitionDuration}`;}); await p.mouse.up(); return st; }
const all=async()=>p.evaluate(()=>{let moving=0, n=0; document.querySelectorAll('.phone *').forEach(e=>{for(const pe of [null,'::before','::after']){const c=getComputedStyle(e,pe); n++; if(c.transitionDuration.split(',').some(d=>parseFloat(d)>0)||c.animationName!=='none') moving++;}}); return `${moving} of ${n} boxes in the phones transition/animate`;});
for (const [label,fn] of [['no preference',async()=>p.emulateMedia({reducedMotion:'no-preference'})],['prefers-reduced-motion: reduce',async()=>p.emulateMedia({reducedMotion:'reduce'})],['gallery sim switch',async()=>{await p.emulateMedia({reducedMotion:'no-preference'}); await p.check('#motion-mode');}]]) {
  await fn();
  console.log(label.padEnd(32), '| play press:', await press('.t-dawn .btn-play'), '| roll press:', await press('.t-dawn .btn-roll'), '| library press:', await press('.t-dawn .row-2 .btn'), '| off key at rest:', await p.evaluate(()=>getComputedStyle(document.querySelector('.t-dawn .layer.dim .btn-on')).transform), '|', await all());
}
await b.close();
