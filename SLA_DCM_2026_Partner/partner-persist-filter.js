(()=>{
'use strict';
const E=['대웅제약','대웅바이오','한올바이오'];
const $=id=>document.getElementById(id);
function norm(v){return window.DCMLogic?.normStatus?window.DCMLogic.normStatus(v):String(v||'').trim().toUpperCase();}
function key(r){return `${r.outlet}|||${r.businessNo}`;}
function partnerName(){return $('partner')?.value||'백제약품';}
function loadData(){try{const x=JSON.parse(localStorage.getItem(`dcm-partner-v1-data::${partnerName()}`));return Array.isArray(x)?x:[];}catch(e){return [];}}
function currentMonth(data){return $('month')?.value||[...new Set(data.map(r=>r.month).filter(Boolean))].sort().at(-1)||'';}
function currentOutlet(){return $('outlet')?.value||'전체';}
function render(){
  const data=loadData(),cur=currentMonth(data),outlet=currentOutlet();
  if(!cur){['persistAbs','persistState','all3Abs','all3State'].forEach(id=>{if($(id))$(id).textContent='-';});return;}
  const curr=data.filter(r=>r.month===cur&&(outlet==='전체'||r.outlet===outlet));
  const keys=new Set(curr.map(key));
  const months=[...new Set(data.map(r=>r.month).filter(m=>m&&m<=cur))].sort();
  const hist=new Map();
  data.filter(r=>months.includes(r.month)&&keys.has(key(r))).forEach(r=>{const k=key(r);if(!hist.has(k))hist.set(k,{});hist.get(k)[r.month]=r;});
  let persistAbs=0,persistState=0,all3Abs=0,all3State=0;
  curr.forEach(r=>{
    const h=hist.get(key(r))||{};let hasPersist=false;
    E.forEach(e=>{let streak=0;for(let i=months.length-1;i>=0;i--){if(norm(h[months[i]]?.statuses?.[e])==='X')streak++;else break;}if(streak>=2){persistState++;hasPersist=true;}});
    if(hasPersist)persistAbs++;
    if(E.every(e=>norm(r.statuses?.[e])==='X')){all3Abs++;all3State+=3;}
  });
  const set=(id,v,suffix)=>{if($(id))$(id).textContent=`${v.toLocaleString()}${suffix}`;};
  set('persistAbs',persistAbs,'처');set('persistState',persistState,'건');set('all3Abs',all3Abs,'처');set('all3State',all3State,'건');
}
function installStyle(){if($('partnerPersistStyle'))return;const s=document.createElement('style');s.id='partnerPersistStyle';s.textContent='.persist-matrix-card{padding-top:14px;padding-bottom:10px}.persist-matrix{display:grid;grid-template-columns:1.35fr .82fr .92fr;gap:3px 7px;align-items:center;margin-top:4px;line-height:1.08}.persist-matrix>small{text-align:center;font-size:9px}.persist-matrix>label{font-size:10px;font-weight:700;white-space:nowrap}.persist-matrix>b{font-size:18px;line-height:1;text-align:center;color:#d97706}.persist-matrix #all3Abs,.persist-matrix #all3State{color:#dc2626}.persist-matrix-card>small{font-size:8.5px;margin-top:4px;display:block}';document.head.appendChild(s);}
function schedule(){setTimeout(render,30);setTimeout(render,180);}
function start(){installStyle();['partner','outlet','month','fileInput'].forEach(id=>$(id)?.addEventListener('change',schedule));window.addEventListener('storage',e=>{if(String(e.key||'').startsWith('dcm-partner-v1-data::'))schedule();});schedule();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();