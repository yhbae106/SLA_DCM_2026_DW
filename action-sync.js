(()=>{
'use strict';
const CFG=window.DCM_ACTION_SYNC||{}, REASONS=window.DCM_ACTION_REASONS||{};
const ACTION_KEY='dcm-dashboard-v10-actions';
const DATA_KEY='dcm-dashboard-v8-data';
const EDITOR_KEY='dcm-action-sync-editor';
const TOKEN_KEY='dcm-action-sync-key';
const REMOTE_HASH_KEY='dcm-action-sync-last-remote';
const REASON_HASH_KEY='dcm-action-sync-reason-hash';
const RISK_HASH_KEY='dcm-action-sync-risk-hash';
const REASON_SCHEMA_KEY='dcm-action-reason-schema-v2';
const originalSetItem=Storage.prototype.setItem;
let suppressSync=false,pollTimer=null,snapshotTimer=null,lastMeta=null,lastPullAt=0,lastEditAt=0;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
function endpoint(){return String(CFG.endpoint||'').trim();}
function token(){return localStorage.getItem(TOKEN_KEY)||'';}
function editor(){return localStorage.getItem(EDITOR_KEY)||CFG.editors?.[0]||'';}
function hash(v){try{return JSON.stringify(v||[]);}catch(e){return ''}}
function getLocalActions(){try{const x=JSON.parse(localStorage.getItem(ACTION_KEY));return Array.isArray(x)?x:[];}catch(e){return []}}
function migrateLegacyLocalReasons(){
 if(localStorage.getItem(REASON_SCHEMA_KEY)==='1')return;
 const map={'01':'01','02':'04','03':'03','04':'03','05':'06','06':'05','07':'','08':'03','09':'','99':''};
 const actions=getLocalActions();let changed=false;
 actions.forEach(a=>{const old=String(a?.reasonCode||'');if(old&&Object.prototype.hasOwnProperty.call(map,old)){const next=map[old];if(next!==old){a.reasonCode=next;changed=true;}}});
 if(changed){suppressSync=true;originalSetItem.call(localStorage,ACTION_KEY,JSON.stringify(actions));suppressSync=false;}
 localStorage.setItem(REASON_SCHEMA_KEY,'1');
}
function getData(){try{const x=JSON.parse(localStorage.getItem(DATA_KEY));if(Array.isArray(x)&&x.length)return x;}catch(e){}try{return JSON.parse(JSON.stringify(window.DCM_BASE_DATA||[]));}catch(e){return []}}
function rowKey(r){return `${r.outlet}|||${r.businessNo}`;}
function months(data){return [...new Set(data.map(r=>r.month).filter(Boolean))].sort();}
function currentMonth(data){return $('month')?.value||months(data).slice(-1)[0]||null;}
function scoped(data,m){const manager=$('manager')?.value||'전체',outlet=$('outlet')?.value||'전체';return data.filter(r=>r.month===m&&(manager==='전체'||r.manager===manager)&&(outlet==='전체'||r.outlet===outlet));}
function stableActions(actions){return (actions||[]).map(a=>({key:a.key||'',priority:a.priority||'',businessName:a.businessName||'',outlet:a.outlet||'',manager:a.manager||'',aging:a.aging||'',reasonCode:a.reasonCode||'',plan:a.plan||'',dueDate:a.dueDate||'',status:a.status||'TODO',modifiedBy:a.modifiedBy||'',updatedAt:a.updatedAt||''})).sort((a,b)=>String(a.key).localeCompare(String(b.key)));}
function actionHash(actions){return hash(stableActions(actions));}
function editableSig(a){return hash([a?.reasonCode||'',a?.plan||'',a?.dueDate||'',a?.status||'TODO']);}
function setStatus(text,state='idle',meta){const el=$('ctSyncStatus');if(!el)return;el.className=`ct-sync-status ${state}`;el.textContent=text;if(meta!==undefined){lastMeta=meta;const m=$('ctSyncMeta');if(m)m.textContent=meta||'';}}
function installUI(){
 const board=[...document.querySelectorAll('.ct-panel')].find(x=>x.querySelector('h2')?.textContent.includes('Action Board'));
 if(!board||$('ctSyncBar'))return;
 const head=board.querySelector('.section-head');if(!head)return;
 const wrap=document.createElement('div');wrap.id='ctSyncBar';wrap.className='ct-sync-bar';
 const opts=(CFG.editors||[]).map(x=>`<option ${x===editor()?'selected':''}>${esc(x)}</option>`).join('');
 wrap.innerHTML=`<span class="ct-sync-dot"></span><strong>공용 Sync</strong><select id="ctSyncEditor" title="수정자">${opts}</select><input id="ctSyncKey" type="password" autocomplete="off" placeholder="공유키" value="${esc(token())}"><button class="ct-btn" id="ctSyncConnect">동기화</button><span id="ctSyncStatus" class="ct-sync-status idle">연결 전</span><small id="ctSyncMeta"></small>`;
 head.appendChild(wrap);
 $('ctSyncEditor')?.addEventListener('change',e=>localStorage.setItem(EDITOR_KEY,e.target.value));
 $('ctSyncKey')?.addEventListener('change',e=>localStorage.setItem(TOKEN_KEY,e.target.value.trim()));
 $('ctSyncConnect')?.addEventListener('click',async()=>{localStorage.setItem(TOKEN_KEY,$('ctSyncKey')?.value.trim()||'');await syncReasonsIfNeeded(true);await pullRemote(true);scheduleRiskSnapshot(250,true);});
}
function syncReasonOptions(){
 document.querySelectorAll('#ctActionBody select[data-field="reasonCode"],#ctActionBody select[data-allx-field="reasonCode"]').forEach(sel=>{
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
   let streak=0,score=0,xCount=0;
   E.forEach(e=>{let n=0;for(let i=ms.length-1;i>=0;i--){if(L.normStatus(hist[ms[i]]?.statuses?.[e])==='X')n++;else break;}streak=Math.max(streak,n);if(L.normStatus(r.statuses?.[e])!=='X')return;xCount++;score+=2;if(n>=2)score+=3*Math.min(n-1,3);if(o2x.has(`${r.outlet}|||${r.businessNo}|||${e}`))score+=4;if(!L.normStatus(pmap.get(k)?.statuses?.[e]))score+=2;});
   const existing=localMap.get(k)||{};
   out.push({...existing,key:k,outlet:r.outlet||'',businessNo:r.businessNo||'',priority:score>=12?'P1':score>=7?'P2':'P3',businessName:r.businessName||'',manager:r.manager||'',aging:`${streak}M`,reasonCode:existing.reasonCode||'',plan:existing.plan||'',dueDate:existing.dueDate||'',status:existing.status||'TODO',modifiedBy:existing.modifiedBy||'',score,xCount});
 });
 return out.sort((a,b)=>b.score-a.score||b.xCount-a.xCount||String(a.businessName).localeCompare(String(b.businessName),'ko'));
}
function observeBoard(){
 const root=$('ctActionBody');if(root){
   const obs=new MutationObserver(()=>syncReasonOptions());obs.observe(root,{childList:true,subtree:true});
   root.addEventListener('change',()=>{lastEditAt=Date.now();},{capture:true});
 }
 syncReasonOptions();
 ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>scheduleRiskSnapshot(900,false)));
 $('fileInput')?.addEventListener('change',()=>scheduleRiskSnapshot(1600,false));
}
function enrichActions(actions){
 const rows={};document.querySelectorAll('#ctActionBody tr').forEach(tr=>{const sel=tr.querySelector('[data-key]');if(!sel)return;const cells=tr.querySelectorAll('td');if(cells.length<9)return;const hasScore=cells.length>=10;rows[sel.dataset.key]={priority:cells[0]?.innerText.trim()||'',businessName:cells[hasScore?2:1]?.innerText.trim()||'',outlet:cells[hasScore?3:2]?.innerText.trim()||'',manager:cells[hasScore?4:3]?.innerText.trim()||'',aging:cells[hasScore?5:4]?.innerText.trim()||''};});
 return (actions||[]).map(a=>({...a,...(rows[a.key]||{}),modifiedBy:editor()}));
}
async function post(payload){
 if(!endpoint()||!token())throw new Error(!endpoint()?'Apps Script URL 미설정':'공유키를 입력해 주세요');
 const res=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:token()})});
 if(!res.ok)throw new Error(`HTTP ${res.status}`);const json=await res.json();if(!json.ok)throw new Error(json.error||'Sync 실패');return json;
}
async function syncReasonsIfNeeded(force=false){
 if(!endpoint()||!token())return;
 const reasonHash=hash(REASONS);if(!force&&sessionStorage.getItem(REASON_HASH_KEY)===reasonHash)return;
 await post({type:'syncReasons',editor:editor(),reasons:REASONS});sessionStorage.setItem(REASON_HASH_KEY,reasonHash);
}
async function pushChanged(actions){
 if(!actions?.length)return;
 try{setStatus('저장 중…','working');const enriched=enrichActions(actions);const json=await post({type:'save',mode:'edit',editor:editor(),actions:enriched});const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||editor()} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:'저장됨';setStatus('저장됨 ✓','ok',meta);}
 catch(e){console.warn('[DCM Action Sync] push failed',e);setStatus('로컬 저장됨 · 공용 Sync 실패','error',e.message);}
}
function riskSignature(snapshot){return hash((snapshot||[]).map(a=>[a.key,a.priority,a.businessName,a.outlet,a.manager,a.aging]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
async function pushRiskSnapshot(force=false){
 if(!endpoint()||!token())return;
 const snapshot=allRiskRows();if(!snapshot.length)return;
 const sig=riskSignature(snapshot);if(!force&&sessionStorage.getItem(RISK_HASH_KEY)===sig)return;
 try{
   setStatus('Risk 목록 동기화 중…','working');
   const json=await post({type:'save',mode:'snapshot',editor:editor(),actions:snapshot});
   sessionStorage.setItem(RISK_HASH_KEY,sig);
   const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||'-'} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:`Risk ${snapshot.length}건 확인`;
   setStatus(`Risk ${snapshot.length}건 동기화 ✓`,'ok',meta);
 }catch(e){console.warn('[DCM Action Sync] risk snapshot failed',e);setStatus('Risk 목록 Sync 실패','error',e.message);}
}
function scheduleRiskSnapshot(delay=900,force=false){if(snapshotTimer)clearTimeout(snapshotTimer);snapshotTimer=setTimeout(()=>pushRiskSnapshot(force),delay);}
function isEditing(){return !!document.activeElement?.closest?.('#ctActionBody')||Date.now()-lastEditAt<8000;}
async function pullRemote(force=false){
 try{
   installUI();if(!endpoint()){setStatus('Apps Script URL 대기','error');return;}if(!token()){setStatus('공유키 입력 필요','idle');return;}
   if(!force&&(document.visibilityState!=='visible'||isEditing()))return;
   setStatus('동기화 확인 중…','working');
   const url=new URL(endpoint());url.searchParams.set('token',token());url.searchParams.set('type','load');
   const res=await fetch(url.toString(),{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const json=await res.json();if(!json.ok)throw new Error(json.error||'불러오기 실패');
   lastPullAt=Date.now();const remote=Array.isArray(json.actions)?json.actions:[],local=getLocalActions();
   const rHash=actionHash(remote),lHash=actionHash(local);const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||'-'} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:'공용 데이터 없음';
   if(remote.length&&rHash!==lHash){
     if(isEditing()&&!force){setStatus('새 공용 데이터 있음','working',meta);return;}
     suppressSync=true;originalSetItem.call(localStorage,ACTION_KEY,JSON.stringify(remote));suppressSync=false;sessionStorage.setItem(REMOTE_HASH_KEY,rHash);
     window.dispatchEvent(new CustomEvent('dcm-action-sync-applied',{detail:{actions:remote}}));
     setStatus('공용 데이터 반영 ✓','ok',meta);
   }else setStatus('동기화됨 ✓','ok',meta);
   syncReasonOptions();
 }catch(e){console.warn('[DCM Action Sync] pull failed',e);setStatus('공용 Sync 실패','error',e.message);}
}
Storage.prototype.setItem=function(k,v){
 if(this!==localStorage||k!==ACTION_KEY||suppressSync){originalSetItem.call(this,k,v);return;}
 const before=getLocalActions();originalSetItem.call(this,k,v);
 try{
   const after=JSON.parse(v);if(!Array.isArray(after))return;
   const beforeMap=new Map(before.map(a=>[a.key,a]));const changed=after.filter(a=>a?.key&&editableSig(a)!==editableSig(beforeMap.get(a.key)));
   if(changed.length){lastEditAt=Date.now();setTimeout(()=>pushChanged(changed),80);}
 }catch(e){}
};
function start(){
 migrateLegacyLocalReasons();installUI();observeBoard();
 syncReasonsIfNeeded(false).catch(e=>console.warn('[DCM Action Sync] reason sync failed',e));
 pullRemote(false).then(()=>scheduleRiskSnapshot(1400,false));
 if(pollTimer)clearInterval(pollTimer);const poll=Math.max(180000,Number(CFG.pollMs)||180000);pollTimer=setInterval(()=>pullRemote(false),poll);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastPullAt>poll)pullRemote(false);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,100),{once:true});else setTimeout(start,100);
window.DCMActionSync={pull:()=>pullRemote(true),push:()=>pushChanged(getLocalActions()),pushRisk:()=>pushRiskSnapshot(true),allRisk:()=>allRiskRows(),reasons:REASONS};
})();
