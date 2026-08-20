(()=>{
'use strict';
const $=id=>document.getElementById(id);
const L=window.DCMLogic;
const CFG=window.DCM_CONFIG||{};
const DATA_KEY='dcm-dashboard-v8-data';
let renderTimer=null;
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function data(){try{const x=JSON.parse(localStorage.getItem(DATA_KEY));if(Array.isArray(x)&&x.length)return x;}catch(e){}return window.DCM_BASE_DATA||[];}
function months(rows){return [...new Set(rows.map(r=>r.month).filter(Boolean))].sort();}
function filter(rows,month,outlet){return L.filterRecords(rows,{month,manager:$('manager')?.value||'전체',outlet:outlet??($('outlet')?.value||'전체')});}
function pct(rate){return rate==null?'—':`${(rate*100).toFixed(1)}%`;}
function pp(delta){if(delta==null||!Number.isFinite(delta))return '—';return `${delta>=0?'▲':'▼'} ${Math.abs(delta*100).toFixed(1)}%p`;}
function shortMonth(m){if(!m)return '';const p=m.split('-');return `${Number(p[1])}월`;}
function rateStatus(rate,delta){const v=(rate??0)*100,d=(delta??0)*100;let label=v>=90?'우수':v>=80?'양호':v>=65?'주의':'위험';if(d<=-5&&label==='우수')label='양호';else if(d<=-5&&label==='양호')label='주의';return label;}
function renderEntities(){
 const box=$('entityCards');if(!box||!L)return;
 const rows=data(),cur=$('month')?.value||'',ms=months(rows),idx=ms.indexOf(cur),chartMonths=ms.slice(Math.max(0,idx-2),idx+1),prev=idx>0?ms[idx-1]:null;
 const curScope=filter(rows,cur),prevScope=prev?filter(rows,prev):[];
 const cs=L.summarize(curScope),ps=prev?L.summarize(prevScope):null;
 box.innerHTML=L.E.map((e,i)=>{
   const c=cs.byEntity[e],p=ps?.byEntity?.[e],delta=(c?.rate!=null&&p?.rate!=null)?c.rate-p.rate:null;
   const bars=chartMonths.map(m=>{const s=L.summarize(filter(rows,m)),r=s.byEntity[e]?.rate??0,h=Math.max(8,Math.round(r*76));return `<div class="entity-trend-col"><span>${pct(r)}</span><i style="height:${h}px"></i><b>${shortMonth(m)}</b></div>`;}).join('');
   return `<div class="entity-card entity-card-v2"><div class="entity-summary"><div class="entity-name">${esc(e)}</div><div class="entity-rate">${pct(c?.rate)}</div><div class="entity-delta ${delta==null?'':delta>=0?'up':'down'}">전월 대비 ${pp(delta)}</div><div class="mini"><span>O ${(c?.O||0).toLocaleString()}</span><span>X ${(c?.X||0).toLocaleString()}</span><span>평가 ${((c?.O||0)+(c?.X||0)).toLocaleString()}</span></div></div><div class="entity-trend" aria-label="${esc(e)} 월별 연동률">${bars}</div></div>`;
 }).join('');
}
function renderOutlets(){
 const body=$('outletBody');if(!body||!L)return;
 const table=body.closest('table'),rows=data(),cur=$('month')?.value||'',ms=months(rows),idx=ms.indexOf(cur),prev=idx>0?ms[idx-1]:null;
 const manager=$('manager')?.value||'전체',selected=$('outlet')?.value||'전체';
 const outs=(CFG.outlets||[]).filter(o=>(manager==='전체'||CFG.managerByOutlet?.[o]===manager)&&(selected==='전체'||o===selected));
 const head=table?.querySelector('thead tr');
 if(head)head.innerHTML='<th>업체/권역</th><th>담당자</th><th>대웅제약</th><th>대웅바이오</th><th>한올바이오</th><th>전체</th><th>전월비(%p)</th><th>상태</th><th>X 평가처수</th><th>연동 필요처수</th><th>공급처수</th>';
 body.innerHTML=outs.map(o=>{
   const c=L.summarize(L.filterRecords(rows,{month:cur,outlet:o}));
   const p=prev?L.summarize(L.filterRecords(rows,{month:prev,outlet:o})):null;
   const delta=(c.rate!=null&&p?.rate!=null)?c.rate-p.rate:null,status=rateStatus(c.rate,delta);
   return `<tr><td><strong>${esc(o)}</strong></td><td>${esc(CFG.managerByOutlet?.[o]||'')}</td>${L.E.map(e=>`<td>${pct(c.byEntity[e].rate)} <small>(O ${c.byEntity[e].O}/X ${c.byEntity[e].X})</small></td>`).join('')}<td><strong>${pct(c.rate)}</strong><br><small>O ${c.O}/${c.evaluated}</small></td><td class="outlet-delta ${delta==null?'':delta>=0?'up':'down'}">${pp(delta)}</td><td><span class="outlet-status status-${status}">${status}</span></td><td>${c.X.toLocaleString()}</td><td><strong>${c.needAbsolute.toLocaleString()}</strong></td><td>${c.suppliedAbsolute.toLocaleString()}</td></tr>`;
 }).join('')||'<tr><td colspan="11" class="empty">데이터가 없습니다.</td></tr>';
}
function relabelAging(){
 const labels=[['ctAge1','1개월'],['ctAge2','2개월'],['ctAge3','3개월'],['ctAge46','4~6개월'],['ctAge6','6개월+']];
 labels.forEach(([id,label])=>{const strong=$(id),box=strong?.closest('.ct-age');if(!box)return;for(const n of [...box.childNodes])if(n.nodeType===3)n.remove();box.insertBefore(document.createTextNode(label),strong);});
}
function renderAll(){renderEntities();renderOutlets();relabelAging();}
function schedule(delay=30){clearTimeout(renderTimer);renderTimer=setTimeout(renderAll,delay);}
function start(){
 renderAll();
 ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>schedule(20)));
 const upload=$('uploadMsg');if(upload)new MutationObserver(()=>schedule(80)).observe(upload,{childList:true,subtree:true,characterData:true});
 window.addEventListener('storage',e=>{if(e.key===DATA_KEY)schedule(50);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,180),{once:true});else setTimeout(start,180);
})();
