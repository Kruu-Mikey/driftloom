import { chromium } from 'playwright'; import path from 'path'; import { PNG } from 'pngjs';
const file=process.argv[2]; const only=process.argv[3]||'';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.route('**/*', r=>r.request().url().startsWith('file://')?r.continue():r.abort());
await p.goto('file://'+path.resolve(file));
const L=(r,g,b)=>{const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
const CR=(a,b)=>{const x=L(...a),y=L(...b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const themes=await p.evaluate(()=>[...document.querySelectorAll('.phone')].map(ph=>[...ph.classList].find(c=>c.startsWith('t-'))));
const kinds=[['mini','.layer:nth-child(2) .btn-roll'],['switch','.layer:nth-child(3) .btn-on'],['prev','.row-1 .btn:first-child'],['play','.btn-play'],['next','.row-1 .btn:last-child'],['lib','.row-2 .btn:first-child'],['save','.row-2 .btn:last-child'],['now','.row-3 .btn:first-child'],['sound','.row-3 .btn:last-child']];
const out=[]; let worst=99;
await p.keyboard.press('Tab');
for (const th of themes) { if(only && th!==only) continue; const row=[th];
 for (const [k,sel] of kinds) {
  const el=await p.$(`.${th} ${sel}`); await el.scrollIntoViewIfNeeded(); await p.evaluate(()=>document.activeElement&&document.activeElement.blur());
  const bb=await el.boundingBox(); const clip={x:bb.x-6,y:bb.y-6,width:bb.width+12,height:bb.height+12};
  const A=PNG.sync.read(await p.screenshot({clip})); await p.keyboard.press("Shift"); await el.focus(); if(!(await el.evaluate(e=>e.matches(":focus-visible")))) throw new Error("no fv "+th+k); const B=PNG.sync.read(await p.screenshot({clip}));
  const vals=[]; const bg=[]; const inner=[];
  for(let y=0;y<A.height;y++)for(let x=0;x<A.width;x++){ const cx=x-6, cy=y-6;
    const dx=Math.max(-cx,cx-bb.width+1,0), dy=Math.max(-cy,cy-bb.height+1,0);
    if(dx>0&&dy>0) continue; const R=Math.min(16,bb.width/2-4,bb.height/2-4); if(dx>0 && (cy<R||cy>bb.height-R)) continue; if(dy>0 && (cx<R||cx>bb.width-R)) continue; const d=Math.max(dx,dy); if(d>=1&&d<=2){const j=(y*A.width+x)*4; inner.push(CR([A.data[j],A.data[j+1],A.data[j+2]],[B.data[j],B.data[j+1],B.data[j+2]]));} if(d<3||d>4) continue;
    const i=(y*A.width+x)*4; vals.push(CR([A.data[i],A.data[i+1],A.data[i+2]],[B.data[i],B.data[i+1],B.data[i+2]])); bg.push([A.data[i],A.data[i+1],A.data[i+2]]); }
  vals.sort((a,b)=>a-b); inner.sort((a,b)=>a-b); const p5o=vals[Math.floor(vals.length*0.05)], p5i=inner[Math.floor(inner.length*0.05)]; const p5=Math.max(p5o,p5i);
  worst=Math.min(worst,p5); row.push(`${k}:${p5.toFixed(2)}${p5i>p5o?'i':''}`);
  if (only) { const avg=bg.reduce((a,c)=>[a[0]+c[0],a[1]+c[1],a[2]+c[2]],[0,0,0]).map(v=>Math.round(v/bg.length)); row.push(`bgavg(${avg})`); }
 }
 out.push(row.join(' '));
}
console.log(out.join('\n')); console.log('WORST 5th-percentile ring contrast:', worst.toFixed(2));
await b.close();
