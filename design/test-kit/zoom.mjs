import { chromium } from 'playwright'; import path from 'path';
const b=await chromium.launch();
for (const [w,h,label] of [[1280,800,'100% zoom'],[640,400,'200% zoom (1280 window)'],[320,256,'400% zoom / 320 reflow']]) {
  const p=await (await b.newContext({viewport:{width:w,height:h}})).newPage();
  await p.route('**/*', r=>r.request().url().startsWith('file://')?r.continue():r.abort());
  await p.goto('file://'+path.resolve(process.argv[2]));
  const r=await p.evaluate(()=>{const de=document.documentElement; const wide=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && r.right>innerWidth+1 && !e.closest('.phone')}).slice(0,6).map(e=>e.tagName.toLowerCase()+'.'+[...e.classList].join('.')+':'+Math.round(e.getBoundingClientRect().right));
    const ph=document.querySelector('.phone').getBoundingClientRect(); return {scrollW:de.scrollWidth, innerW:innerWidth, phoneLeft:Math.round(ph.left), phoneRight:Math.round(ph.right), phoneW:Math.round(ph.width), wide};});
  console.log(label, JSON.stringify(r));
  if (w===320) await p.screenshot({path:'out/reflow320.png'});
}
await b.close();
