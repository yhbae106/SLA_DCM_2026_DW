(()=>{
'use strict';
const CFG=window.DCM_ACTION_SYNC||{}, REASONS=window.DCM_ACTION_REASONS||{};
const ACTION_KEY='dcm-dashboard-v10-actions';
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
function collectBoardRows(){
 const localMap=new Map(getLocalActions().map(a=>[a.key,a]));
 const rows=[];
 document.querySelectorAll('#ctActionBody tr').forEach(tr=>{
   const keyed=tr.querySelector('[data-key]');if(!keyed)return;
   const k=keyed.dataset.key,cells=tr.querySelectorAll('td');if(!k||cells.length<9)return;
   const existing=localMap.get(k)||{};
   const reason=tr.querySelector('[data-field="reasonCode"]')?.value??existing.reasonCode??'';
   const plan=tr.querySelector('[data-field="plan"]')?.value??existing.plan??'';
   const due=tr.querySelector('[data-field="dueDate"]')?.value??existing.dueDate??'';
   const status=tr.querySelector('[data-field="status"]')?.value??existing.status??'TODO';
   const parts=k.split('|||');
   rows.push({...existing,key:k,outlet:cells[2]?.innerText.trim()||parts[0]||'',businessNo:existing.businessNo||parts[1]||'',priority:cells[0]?.innerText.trim()||'',businessName:cells[1]?.innerText.trim()||'',manager:cells[3]?.innerText.trim()||'',aging:cells[4]?.innerText.trim()||'',reasonCode:reason,plan:plan,dueDate:due,status:status,modifiedBy:existing.modifiedBy||editor()});
 });
 return rows;
}
function observeBoard(){
 const root=$('ctActionBody');if(!root)return;
 const obs=new MutationObserver(()=>{syncReasonOptions();scheduleRiskSnapshot(700);});
 obs.observe(root,{childList:true,subtree:true});syncReasonOptions();scheduleRiskSnapshot(900);
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
 const snapshot=collectBoardRows();if(!snapshot.length)return;
 try{
   setStatus('Risk 목록 동기화 중…','working');
   const json=await post({type:'save',editor:editor(),actions:snapshot,reasons:REASONS});
   const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||editor()} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:`Risk ${snapshot.length}건 동기화`;
   setStatus(`Risk ${snapshot.length}건 동기화 ✓`,'ok',meta);
 }catch(e){console.warn('[DCM Action Sync] risk snapshot failed',e);setStatus('Risk 목록 Sync 실패','error',e.message);}
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
window.DCMActionSync={pull:()=>pullRemote(true),push:()=>pushLocal(getLocalActions()),pushRisk:()=>pushRiskSnapshot(),reasons:REASONS};
})();
