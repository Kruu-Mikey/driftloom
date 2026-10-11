import { chromium } from 'playwright'; import path from 'path'; import { PNG } from 'pngjs';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const file=process.argv[2];
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1500,height:1000}}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(file)); await p.evaluate(()=>document.fonts.ready);

// 1. tab order inside phone 1
await p.focus('#motion-mode');
const stops=[];
for (let k=0;k<40 && stops.length<17;k++){ await p.keyboard.press('Tab');
  const r=await p.evaluate(()=>{const a=document.activeElement; const ph=a.closest('.phone'); return ph&&ph.classList.contains('t-dawn')? (a.getAttribute('role')||a.tagName.toLowerCase())+':'+(a.getAttribute('aria-label')||a.textContent):null;});
  if(r) stops.push(r); }
console.log('TAB ORDER (Dawn):', stops.join(' | '));
// 2. keyboard operation
await p.evaluate(()=>document.querySelector('.t-dawn .layer .btn-on').focus());
const before=await p.evaluate(()=>{const s=document.querySelector('.t-dawn .layer .btn-on');return [s.getAttribute('aria-checked'),s.textContent,s.closest('.layer').classList.contains('dim')].join(',')});
await p.keyboard.press('Space');
const after=await p.evaluate(()=>{const s=document.querySelector('.t-dawn .layer .btn-on');return [s.getAttribute('aria-checked'),s.textContent,s.closest('.layer').classList.contains('dim')].join(',')});
console.log('Drums switch via Space:', before,'->',after);
await p.keyboard.press('Space');
await p.evaluate(()=>document.querySelector('.t-dawn .btn-play').focus()); await p.keyboard.press('Enter');
console.log('Play via Enter -> playing:', await p.evaluate(()=>document.querySelector('.t-dawn').classList.contains('playing')), 'label:', await p.evaluate(()=>document.querySelector('.t-dawn .btn-play').getAttribute('aria-label')));
await p.keyboard.press('Enter');
await p.evaluate(()=>document.querySelector('.t-dawn .btn-roll').focus()); const pb=await p.evaluate(()=>document.querySelector('.t-dawn .pattern').getAttribute('aria-label')+' '+[...document.querySelectorAll('.t-dawn .pattern span')].map(x=>x.className?'x':'.').join(''));
await p.keyboard.press('Enter'); const pa=await p.evaluate(()=>document.querySelector('.t-dawn .pattern').getAttribute('aria-label')+' '+[...document.querySelectorAll('.t-dawn .pattern span')].map(x=>x.className?'x':'.').join(''));
console.log('Roll via Enter:', pb, '->', pa);

// 3. focus ring contrast, every theme, three control kinds
const L=(r,g,b)=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
const CR=(a,b)=>{const x=L(...a),y=L(...b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const themes=await p.evaluate(()=>[...document.querySelectorAll('.phone')].map(ph=>[...ph.classList].find(c=>c.startsWith('t-'))));
const rows=[];
for (const th of themes) for (const [kind,sel] of [['mini',`.${th} .layer:nth-child(2) .btn-roll`],['icon',`.${th} .row-2 .btn:first-child`],['play',`.${th} .btn-play`]]) {
  const el=await p.$(sel); await el.scrollIntoViewIfNeeded();
  await p.evaluate(()=>document.activeElement&&document.activeElement.blur());
  const bb=await el.boundingBox(); const clip={x:bb.x-6,y:bb.y-6,width:bb.width+12,height:bb.height+12};
  const A=PNG.sync.read(await p.screenshot({clip}));
  await p.keyboard.press('Shift'); await el.focus();
  const fv=await el.evaluate(e=>e.matches(':focus-visible'));
  const B=PNG.sync.read(await p.screenshot({clip}));
  // ring pixels = band 2..4px outside the border box
  let n=0, ok=0, min=99;
  const W=A.width, H=A.height, sx=W/clip.width;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const cx=x/sx-6, cy=y/sx-6; // css px relative to box
    const dx=Math.max(-cx,cx-bb.width,0), dy=Math.max(-cy,cy-bb.height,0); const d=Math.hypot(dx,dy);
    if(d<2.6||d>3.4) continue; // centre line of the ring band
    const i=(y*W+x)*4; const c=CR([A.data[i],A.data[i+1],A.data[i+2]],[B.data[i],B.data[i+1],B.data[i+2]]);
    n++; if(c>=3) ok++; if(c<min) min=c;
  }
  rows.push([th,kind,fv,n,Math.round(ok/n*100),min.toFixed(2)]);
}
console.log('FOCUS RING  theme kind focus-visible samples %>=3:1 min');
rows.forEach(r=>console.log('  '+r.join('  ')));
// 4. reduced motion
for (const rm of ['no-preference','reduce']) {
  await p.emulateMedia({reducedMotion:rm});
  const el=await p.$('.t-dawn .btn-play'); const bb=await el.boundingBox();
  await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down(); await p.waitForTimeout(150);
  const st=await el.evaluate(e=>{const c=getComputedStyle(e);return {transform:c.transform, filter:c.filter, transition:c.transitionDuration};});
  await p.mouse.up();
  const ph=await p.evaluate(()=>getComputedStyle(document.querySelector('.t-dawn .playhead i.on'),'::after').transitionDuration);
  console.log('motion', rm, JSON.stringify(st), 'playhead fade', ph);
}
await p.emulateMedia({reducedMotion:'no-preference'});
await p.check('#motion-mode');
{ const el=await p.$('.t-dawn .btn-play'); const bb=await el.boundingBox(); await p.mouse.move(bb.x+20,bb.y+20); await p.mouse.down(); await p.waitForTimeout(150);
  console.log('motion sim-toggle', await el.evaluate(e=>getComputedStyle(e).transform)); await p.mouse.up(); }
// 5. aria snapshot of phone 1
console.log('ARIA SNAPSHOT (Dawn):\n'+await p.locator('.t-dawn').ariaSnapshot());
console.log('errors:', errs.length?errs:'none');
await b.close();
