import { chromium } from 'playwright'; import path from 'path';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const SPACING='* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(process.argv[2])); await p.evaluate(()=>document.fonts.ready);
const sizes=[...Array(51).keys()].map(i=>100+i*2);
for (const [label,spacing,name,mode] of [['plain',0,'','observer'],['spacing',1,'','observer'],['spacing 8ch',1,'tsu-kimi','observer'],['spacing 12ch',1,'kyo-shiro-ne','observer'],['plain 12ch',0,'kyo-shiro-ne','observer'],['spacing loomwave',1,'loomwave','observer'],['plain loomwave',0,'loomwave','observer']]) {
  const tag = spacing ? await p.addStyleTag({content:SPACING}) : null;
  if (name) await p.evaluate(n=>document.querySelectorAll('.name').forEach(e=>e.textContent=n), name);
  const fails={}; const trims={}; let splits=0, stacks=0, minName=99;
  for (const s of sizes) {
    await p.evaluate(v=>{document.documentElement.style.fontSize=v+'%';}, s);
    // let the ResizeObserver do it (no manual fitAll), as on a real device
    await p.waitForTimeout(60); await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const a=await p.evaluate(()=>{const r=auditPhones(); const ph=document.querySelector('.phone'); r.split=ph.querySelector('.meta').classList.contains('fit-split'); r.stack=ph.classList.contains('fit-stack'); r.name=parseFloat(getComputedStyle(ph.querySelector('.name')).fontSize); const n=ph.querySelector('.name'); n.style.overflowWrap='normal'; r.midword=n.scrollWidth>n.clientWidth+0.5; n.style.overflowWrap=''; return r;});
    for (const k of Object.keys(a.issues)) (fails[k]=fails[k]||[]).push(s);
    trims[a.alternating.join('+')||'still']=(trims[a.alternating.join('+')||'still']||0)+1;
    if(a.split) splits++; if(a.split && !spacing && s===100) void('   debug', label, JSON.stringify(await p.evaluate(()=>{const m=document.querySelector('.meta'); m.classList.remove('fit-split'); m.querySelectorAll('.fit-trim').forEach(x=>x.classList.remove('fit-trim')); const nm=document.querySelector('.name'); nm.style.fontSize=''; const r=[...m.children].map(l=>[l.className, lineTooWide(l), [...l.querySelectorAll('span:not(.vh)')].map(sp=>[sp.textContent.slice(0,8), [...sp.getClientRects()].map(q=>Math.round(q.left)+'-'+Math.round(q.right)).join('/')]), Math.round(l.getBoundingClientRect().left)+'-'+Math.round(l.getBoundingClientRect().right)]); fitAll(); return {disp:[...m.children].map(l=>getComputedStyle(l).display+'/'+getComputedStyle(l).whiteSpace+'/'+getComputedStyle(l).wordSpacing), root:getComputedStyle(document.documentElement).fontSize, phoneFs:getComputedStyle(document.querySelector('.phone')).fontSize, cls:m.className};}))); if(a.midword) (fails['name broken mid-word']=fails['name broken mid-word']||[]).push(s); if(a.stack) stacks++; minName=Math.min(minName,a.name);
  }
  console.log(label.padEnd(13), Object.keys(fails).length? 'FAIL '+JSON.stringify(Object.fromEntries(Object.entries(fails).map(([k,v])=>[k,v[0]+'..'+v[v.length-1]+' ('+v.length+')']))) : 'ok (51 sizes, observer only)', '| trims', JSON.stringify(trims), '| split', splits, 'stack', stacks, 'min name', minName);
  if (tag) await p.evaluate(t=>t.remove(), tag);
  await p.evaluate(()=>document.querySelectorAll('.name').forEach(e=>e.textContent='me-kei'));
}
console.log('errors', errs.length?errs:'none'); await b.close();
