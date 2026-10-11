import { chromium } from 'playwright'; import path from 'path'; import { PNG } from 'pngjs';
const fd = path.resolve('node_modules/@fontsource');
const css = [400,500,600,700,800].map(w=>`@font-face{font-family:'Inter';font-weight:${w};src:url('file://${fd}/inter/files/inter-latin-${w}-normal.woff2') format('woff2');}`).join('')+[400,500,600,700].map(w=>`@font-face{font-family:'Space Grotesk';font-weight:${w};src:url('file://${fd}/space-grotesk/files/space-grotesk-latin-${w}-normal.woff2') format('woff2');}`).join('');
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}, deviceScaleFactor:2})).newPage();
await p.route('**/*', r=>{const u=r.request().url(); if(u.startsWith('file://')) return r.continue(); if(u.includes('fonts.googleapis.com')) return r.fulfill({contentType:'text/css',body:css}); return r.abort();});
await p.goto('file://'+path.resolve(process.argv[2])); await p.evaluate(()=>document.fonts.ready);
await p.addStyleTag({content:'.masthead,section.handover,.spec,.section-title,.sim-toggle{display:none !important}'});
const L=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
const CR=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const themes=await p.evaluate(()=>[...document.querySelectorAll('.phone')].map(ph=>[...ph.classList].find(c=>c.startsWith('t-'))));
for (const th of themes) { const row=[th.padEnd(13)];
  for (const [k,sel] of [['on','.layer:nth-child(2) .btn-on'],['OFF','.layer:nth-child(1) .btn-on'],['OFF(air)','.layer:nth-child(5) .btn-on'],['roll','.layer:nth-child(2) .btn-roll'],['roll(off)','.layer:nth-child(1) .btn-roll']]) {
    const el=await p.$(`.${th} ${sel}`); await el.scrollIntoViewIfNeeded();
    const A=PNG.sync.read(await el.screenshot()); const col=await el.evaluate(e=>getComputedStyle(e).color);
    await el.evaluate(e=>e.style.setProperty('color','transparent','important')); const B=PNG.sync.read(await el.screenshot()); await el.evaluate(e=>e.style.removeProperty('color'));
    const rgb=col.match(/[\d.]+/g).slice(0,3).map(Number);
    const vals=[]; for(let i=0;i<A.data.length;i+=4){ const d=Math.abs(A.data[i]-B.data[i])+Math.abs(A.data[i+1]-B.data[i+1])+Math.abs(A.data[i+2]-B.data[i+2]); if(d>60) vals.push(CR(rgb,[B.data[i],B.data[i+1],B.data[i+2]])); }
    vals.sort((a,b)=>a-b); row.push(`${k} ${vals[Math.floor(vals.length*0.05)].toFixed(2)}`);
  }
  console.log(row.join('  '));
}
await b.close();
