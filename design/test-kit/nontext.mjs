import { chromium } from 'playwright'; import path from 'path'; import fs from 'fs'; import { PNG } from 'pngjs';
const file=process.argv[2], outJson=process.argv[3];
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}, deviceScaleFactor:2})).newPage();
await p.route('**/*', r=>r.request().url().startsWith('file://')?r.continue():r.abort());
await p.goto('file://'+path.resolve(file)); if(process.env.SHALLOW) await p.addStyleTag({content:'.masthead,section.handover,.spec,.section-title{display:none !important}'+(process.env.HIDEFIRST?'.gallery:has(.t-dawn),.gallery:has(.t-dark){display:none !important}':'')}); if(process.env.ALLON) await p.evaluate(()=>document.querySelectorAll('.layer.dim').forEach(l=>l.classList.remove('dim')));
const L=(c)=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
const CR=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const themes=await p.evaluate(()=>[...document.querySelectorAll('.phone')].map(ph=>[...ph.classList].find(c=>c.startsWith('t-'))));
const res={};
async function shot(ph){ const bb=await ph.boundingBox(); const buf=await p.screenshot({clip:bb}); return {png:PNG.sync.read(buf), bb}; }
const px=(S,x,y)=>{const X=Math.round((x-S.bb.x)*2), Y=Math.round((y-S.bb.y)*2); const i=(Y*S.png.width+X)*4; return [S.png.data[i],S.png.data[i+1],S.png.data[i+2]];};
for (const th of themes) {
  const ph=await p.$('.'+th); if(!(await ph.isVisible())) continue; await ph.scrollIntoViewIfNeeded();
  const geo=await p.evaluate(th=>{const ph=document.querySelector('.'+th); const R=e=>{const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};};
    return {layers:[...ph.querySelectorAll('.layer')].map(L=>({name:L.querySelector('.lbl').textContent, dim:L.classList.contains('dim'), notes:[...L.querySelectorAll('.pattern span.on')].map(R)})),
      cells:[...ph.querySelectorAll('.playhead i')].map(i=>({...R(i), beat:i.classList.contains('beat'), on:i.classList.contains('on')}))};}, th);
  const A=await shot(ph);
  await p.addStyleTag({content:`.${th} .pattern span, .${th} .playhead i { visibility:hidden !important; }`});
  const B=await shot(ph);
  await p.evaluate(th=>{const s=[...document.querySelectorAll('style')].pop(); s.remove();}, th);
  const out={layers:[], beat:[], off:[], lit:null};
  for (const Lr of geo.layers) { let worst=99, worstBg=null, fill=null;
    for (const n of Lr.notes) { const cx=n.x+n.w/2, cy=n.y+n.h/2; const f=px(A,cx,cy); fill=f;
      for (let a=0;a<16;a++){ const ang=a/16*2*Math.PI, r=n.w/2+1.5; const bg=px(B,cx+r*Math.cos(ang),cy+r*Math.sin(ang)); const c=CR(f,bg); if(c<worst){worst=c; worstBg=bg;} } }
    out.layers.push({name:Lr.name, dim:Lr.dim, worst:+worst.toFixed(2), fill, bg:worstBg}); }
  for (const c of geo.cells) { const cx=c.x+c.w/2, cy=c.y+c.h/2; const f=px(A,cx,cy);
    let worst=99, wb=null; for (const [dx,dy] of [[0,-c.h/2-1.5],[0,c.h/2+1.5],[-c.w/2-1.5,0],[c.w/2+1.5,0]]){ const bg=px(B,cx+dx,cy+dy); const r=CR(f,bg); if(r<worst){worst=r;wb=bg;} }
    if (c.on) { // lit cell: best of centre and edge (rim) vs panel
      let edge=99; for (const [dx,dy] of [[0,-c.h/2+0.75],[0,c.h/2-0.75],[-c.w/2+0.75,0],[c.w/2-0.75,0]]){ const e=px(A,cx+dx,cy+dy); const bg=px(B,cx+dx*1.0+(dx?Math.sign(dx)*2.25:0),cy+dy+(dy?Math.sign(dy)*2.25:0)); edge=Math.min(edge,CR(e,bg)); }
      let haze=99, panelE=99; const L2=await 0; for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){ for(const off of [-0.6,-0.3,0.3,0.6]){ const ex=cx+dx*(c.w/2-0.75)+(dy?off*c.w/2:0), ey=cy+dy*(c.h/2+(process.env.TALL?2:0)-0.75)+(dx?off*c.h/2:0); const e=px(A,ex,ey); const o=px(A,ex+dx*2.25,ey+dy*2.25); const ob=px(B,ex+dx*2.25,ey+dy*2.25); haze=Math.min(haze,CR(e,o)); panelE=Math.min(panelE,CR(e,ob)); } }
      out.lit={centre:+worst.toFixed(2), edge:+edge.toFixed(2), haze:+haze.toFixed(2), panelE:+panelE.toFixed(2), fill:f, bg:wb}; }
    else (c.beat?out.beat:out.off).push(+worst.toFixed(2)); }
  out.beatMin=Math.min(...out.beat); out.offMin=Math.min(...out.off); delete out.beat; delete out.off;
  res[th]=out;
}
fs.writeFileSync(outJson, JSON.stringify(res,null,1));
for (const [th,o] of Object.entries(res)) console.log(th.padEnd(13), 'notes(on):', o.layers.filter(l=>!l.dim).map(l=>l.name+' '+l.worst).join(', '), '| off-layer:', o.layers.filter(l=>l.dim).map(l=>l.name+' '+l.worst).join(', '), '| beat', o.beatMin, 'offbeat', o.offMin, '| lit centre', o.lit.centre, 'edge', o.lit.edge, 'edge-vs-aura', o.lit.haze, 'edge-vs-panel', o.lit.panelE);
await b.close();
