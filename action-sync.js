(()=>{
'use strict';
const CFG=window.DCM_ACTION_SYNC||{}, REASONS=window.DCM_ACTION_REASONS||{};
const ACTION_KEY='dcm-dashboard-v10-actions';
const DATA_KEY='dcm-dashboard-v8-data';
const EDITOR_KEY='dcm-action-sync-editor';
const TOKEN_KEY='dcm-action-sync-key';
const REMOTE_HASH_KEY='dcm-action-sync-last-remote';
const originalSetItem=Storage.prototype.setItem;
let suppressSync=false,pollTimer=null,snapshotTimer=null,lastMeta=null;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
function endpoint(){return String(CFG.endpoint||'').trim();}
function token(){return localStorage.getItem(TOKEN_KEY)||'';}
function editor(){return localStorage.getItem(EDITOR_KEY)||CFG.editors?.[0]||'';}
function hash(v){try{return JSON.stringify(v||[]);}catch(e){return ''}}
function getLocalActions(){try{const x=JSON.parse(localStorage.getItem(ACTION_KEY));return Array.isArray(x)?x:[];}catch(e){return []}}
function getData(){try{const x=JSON.parse(localStorage.getItem(DATA_KEY));if(Array.isArray(x)&&x.length)return x;}catch(e){}try{return JSON.parse(JSON.stringify(window.DCM_BASE_DATA||[]));}catch(e){return []}}
function rowKey(r){return `${r.outlet}|||${r.businessNo}`;}
function months(data){return [...new Set(data.map(r=>r.month).filter(Boolean))].sort();}
function currentMonth(data){return $('month')?.value||months(data).slice(-1)[0]||null;}
function scoped(data,m){const manager=$('manager')?.value||'전체',outlet=$('outlet')?.value||'전체';return data.filter(r=>r.month===m&&(manager==='전체'||r.manager===manager)&&(outlet==='전체'||r.outlet===outlet));}
function setStatus(text,state='idle',meta){const el=$('ctSyncStatus');if(!el)return;el.className=`ct-sync-status ${state}`;el.textContent=text;if(meta){lastMeta=meta;const m=$('ctSyncMeta');if(m)m.textContent=meta;}}
function installUI(){
 const board=[...document.querySelectorAll('.ct-panel')].find(x=>x.querySelector('h2')?.textContent.includes('Action Board'));
 if(!board||$('ctSyncBar'))return;
 const head=board.querySelector('.section-head');if(!head)return;
 const wrap=document.createElement('div');wrap.id='ctSyncBar';wrap.className='ct-sync-bar';
 const opts=(CFG.editors||[]).map(x=>`<option ${x===editor()?'selected':''}>${esc(x)}</option>`).join('');
 wrap.innerHTML=`<span class="ct-sync-dot"></span><strong>공용 Sync</strong><select id="ctSyncEditor" title="수정자">${opts}</select><input id="ctSyncKey" type="password" autocomplete="off" placeholder="공유키" value="${esc(token())}"><button class="ct-btn" id="ctSyncConnect">연결/새로고침</button><span id="ctSyncStatus" class="ct-sync-status idle">연결 전</span><small id="ctSyncMeta"></small>`;
 head.appendChild(wrap);
 $('ctSyncEditor')?.addEventListener('change',e=>localStorage.setItem(EDITOR_KEY,e.target.value));
 $('ctSyncKey')?.addEventListener('change',e=>localStorage.setItem(TOKEN_KEY,e.target.value.trim()));
 $('ctSyncConnect')?.addEventListener('click',async()=>{localStorage.setItem(TOKEN_KEY,$('ctSyncKey')?.value.trim()||'');await pullRemote(true);scheduleRiskSnapshot(250);});
}
function syncReasonOptions(){
 document.querySelectorAll('#ctActionBody select[data-field="reasonCode"]').forEach(sel=>{
   const cur=sel.value;
   const html=['<option value="">원인 선택</option>',...Object.entries(REASONS).map(([k,v])=>`<option value="${esc(k)}">${esc(k)} ${esc(v)}</option>`)].join('');
   if(sel.dataset.reasonSource!=='github'){sel.innerHTML=html;sel.dataset.reasonSource='github';sel.value=cur;}
 });
}
function allRiskRows(){
 const L=window.DCMLogic;if(!L)return [];
 const E=L.E||[],data=getData(),cur=currentMonth(data);if(!cur)return [];
 const ms=months(data),idx=ms.indexOf(cur),prev=idx>0?ms[idx-1]:null,curr=scoped(data,cur),prior=prev?scoped(data,prev):[];
 const pmap=new Map(prior.map(r=>[rowKey(r),r])),ch=L.compare(prior,curr),o2x=new Set((ch.oToX||[]).map(x=>`${x.outlet}|||${x.businessNo}|||${x.entity}`)),currentKeys=new Set(curr.map(rowKey));
 const by=new Map();data.filter(r=>ms.includes(r.month)&&r.month<=cur).forEach(r=>{const k=rowKey(r);if(!by.has(k))by.set(k,{});by.get(k)[r.month]=r;});
 const localMap=new Map(getLocalActions().map(a=>[a.key,a]));
 const out=[];
 by.forEach(hist=>{
   const r=hist[cur],k=r&&rowKey(r);if(!r||!currentKeys.has(k)||!E.some(e=>L.normStatus(r.statuses?.[e])==='X'))return;
   const entityStreak={};let streak=0,score=0,xCount=0;
   E.forEach(e=>{let n=0;for(let i=ms.length-1;i>=0;i--){if(L.normStatus(hist[ms[i]]?.statuses?.[e])==='X')n++;else break;}entityStreak[e]=n;streak=Math.max(streak,n);if(L.normStatus(r.statuses?.[e])!=='X')return;xCount++;score+=2;if(n>=2)score+=3*Math.min(n-1,3);if(o2x.has(`${r.outlet}|||${r.businessNo}|||${e}`))score+=4;if(!L.normStatus(pmap.get(k)?.statuses?.[e]))score+=2;});
   const existing=localMap.get(k)||{};
   out.push({...existing,key:k,outlet:r.outlet||'',businessNo:r.businessNo||'',priority:score>=12?'P1':score>=7?'P2':'P3',businessName:r.businessName||'',manager:r.manager||'',aging:`${streak}M`,reasonCode:existing.reasonCode||'',plan:existing.plan||'',dueDate:existing.dueDate||'',status:existing.status||'TODO',modifiedBy:existing.modifiedBy||editor(),score,xCount});
 });
 return out.sort((a,b)=>b.score-a.score||b.xCount-a.xCount||String(a.businessName).localeCompare(String(b.businessName),'ko'));
}
function observeBoard(){
 const root=$('ctActionBody');if(root){const obs=new MutationObserver(()=>syncReasonOptions());obs.observe(root,{childList:true,subtree:true});}
 syncReasonOptions();
 ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>scheduleRiskSnapshot(700)));
}
function enrichActions(actions){
 const rows={};document.querySelectorAll('#ctActionBody tr').forEach(tr=>{const sel=tr.querySelector('[data-key]');if(!sel)return;const cells=tr.querySelectorAll('td');if(cells.length<9)return;rows[sel.dataset.key]={priority:cells[0]?.innerText.trim()||'',businessName:cells[1]?.innerText.trim()||'',outlet:cells[2]?.innerText.trim()||'',manager:cells[3]?.innerText.trim()||'',aging:cells[4]?.innerText.trim()||''};});
 return actions.map(a=>({...a,...(rows[a.key]||{}),modifiedBy:editor()}));
}
async function post(payload){
 if(!endpoint()||!token())throw new Error(!endpoint()?'Apps Script URL 미설정':'공유키를 입력해 주세요');
 const res=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:token()})});
 if(!res.ok)throw new Error(`HTTP ${res.status}`);const json=await res.json();if(!json.ok)throw new Error(json.error||'Sync 실패');return json;
}
async function pushLocal(actions){
 try{setStatus('저장 중…','working');const enriched=enrichActions(actions);const json=await post({type:'save',editor:editor(),actions:enriched,reasons:REASONS});const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||editor()} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:'저장됨';setStatus('저장됨 ✓','ok',meta);sessionStorage.setItem(REMOTE_HASH_KEY,hash(actions));}
 catch(e){console.warn('[DCM Action Sync] push failed',e);setStatus('로컬 저장됨 · 공용 Sync 실패','error',e.message);}
}
async function pushRiskSnapshot(){
 if(!endpoint()||!token())return;
 const snapshot=allRiskRows();if(!snapshot.length)return;
 try{
   setStatus('전체 Risk 동기화 중…','working');
   const json=await post({type:'save',editor:editor(),actions:snapshot,reasons:REASONS});
   const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||editor()} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:`Risk ${snapshot.length}건 동기화`;
   setStatus(`전체 Risk ${snapshot.length}건 동기화 ✓`,'ok',meta);
 }catch(e){console.warn('[DCM Action Sync] risk snapshot failed',e);setStatus('전체 Risk Sync 실패','error',e.message);}
}
function scheduleRiskSnapshot(delay=700){if(snapshotTimer)clearTimeout(snapshotTimer);snapshotTimer=setTimeout(()=>pushRiskSnapshot(),delay);}
async function pullRemote(force=false){
 try{
   installUI();if(!endpoint()){setStatus('Apps Script URL 대기','error');return;}if(!token()){setStatus('공유키 입력 필요','idle');return;}
   setStatus('동기화 중…','working');await post({type:'syncReasons',editor:editor(),reasons:REASONS});
   const url=new URL(endpoint());url.searchParams.set('token',token());url.searchParams.set('type','load');
   const res=await fetch(url.toString(),{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const json=await res.json();if(!json.ok)throw new Error(json.error||'불러오기 실패');
   const remote=Array.isArray(json.actions)?json.actions:[],local=getLocalActions();
   const rHash=hash(remote),lHash=hash(local);const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||'-'} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:'공용 데이터 없음';
   if(remote.length&&rHash!==lHash){
     const editing=document.activeElement?.closest?.('#ctActionBody');
     if(editing&&!force){setStatus('새 공용 데이터 있음','working',meta);return;}
     suppressSync=true;originalSetItem.call(localStorage,ACTION_KEY,JSON.stringify(remote));suppressSync=false;sessionStorage.setItem(REMOTE_HASH_KEY,rHash);setStatus('공용 데이터 반영 ✓','ok',meta);
     const mark=sessionStorage.getItem('dcm-action-sync-reloaded');if(mark!==rHash){sessionStorage.setItem('dcm-action-sync-reloaded',rHash);setTimeout(()=>location.reload(),150);return;}
   }
   setStatus('동기화됨 ✓','ok',meta);syncReasonOptions();
 }catch(e){console.warn('[DCM Action Sync] pull failed',e);setStatus('공용 Sync 실패','error',e.message);}
}
Storage.prototype.setItem=function(k,v){originalSetItem.call(this,k,v);if(this===localStorage&&k===ACTION_KEY&&!suppressSync){try{const a=JSON.parse(v);if(Array.isArray(a))setTimeout(()=>pushLocal(a),0);}catch(e){}}};
function start(){installUI();observeBoard();pullRemote(false).then(()=>scheduleRiskSnapshot(1200));if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>pullRemote(false),Number(CFG.pollMs)||60000);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,100),{once:true});else setTimeout(start,100);
window.DCMActionSync={pull:()=>pullRemote(true),push:()=>pushLocal(getLocalActions()),pushRisk:()=>pushRiskSnapshot(),allRisk:()=>allRiskRows(),reasons:REASONS};
})();
