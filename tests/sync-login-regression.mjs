import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('action-sync.js','utf8');
const hook='window.DCMActionSync={';
assert.ok(source.includes(hook));
const injected=source.replace(hook,
 'window.__syncHarness={start,signInFromButton,pullRemote,logoutSync,renderLoginUI};\n'+hook);

class Store{
 constructor(){this.map=new Map();}
 getItem(key){return this.map.has(key)?this.map.get(key):null;}
 setItem(key,value){this.map.set(key,String(value));}
 removeItem(key){this.map.delete(key);}
}
const localStorage=new Store(),sessionStorage=new Store();
localStorage.setItem('dcm-action-sync-editor','정직한');
localStorage.setItem('dcm-action-sync-key','stale-old-browser-key');

const nodes=new Map();
const createNode=id=>({
 id,value:'',textContent:'',innerHTML:'',className:'',hidden:false,disabled:false,
 dataset:{},events:new Map(),classList:{toggle(){},add(){},remove(){}},
 addEventListener(name,callback){this.events.set(name,callback);},
 focus(){},
 querySelector(query){return query==='.ct-sync-dot'?createNode('dot'):null;},
 closest(){return null}
});
const get=id=>nodes.get(id)||null;
const head={appendChild(node){
 nodes.set(node.id,node);
 for(const match of node.innerHTML.matchAll(/\bid="([^"]+)"/g)){
  const n=createNode(match[1]);
  if(['ctSyncRefresh','ctSyncEditAuth','ctSyncSavePending','ctSyncPinRow'].includes(n.id))n.hidden=true;
  nodes.set(n.id,n);
 }
}};
const board={querySelector(query){
 if(query==='h2')return {textContent:'통합 Action Board'};
 if(query==='.section-head')return head;
 return null;
}};
const document={
 readyState:'loading',visibilityState:'visible',
 activeElement:{closest(){return null;}},
 getElementById:get,
 createElement(){return createNode('')},
 querySelectorAll(query){return query==='.ct-panel'?[board]:[]},
 addEventListener(){}
};
let mode='incorrect',requests=[];
const sandbox={window:null,document,localStorage,sessionStorage,Storage:Store,
 setTimeout(){return 1},clearTimeout(){},setInterval(){return 2},clearInterval(){},
 MutationObserver:class {observe(){}},
 AbortController:class {constructor(){this.signal={};}abort(){}},
 CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
 fetch:async (_url,options)=>{
  const payload=JSON.parse(options.body);
  requests.push(payload);
  if(mode==='http404')return {ok:false,status:404};
  return {ok:true,status:200,json:async()=>mode==='incorrect'?
   {ok:false,error:'공유키가 올바르지 않습니다.'}:
   {ok:true,version:'20261008-seven-reasons-fast-v3',actions:[]}};
 },
 console:{warn(){}}
};
sandbox.window=sandbox;
sandbox.DCM_ACTION_SYNC={endpoint:'https://example.test/exec',editors:['배영훈','정직한','임인숙'],pollMs:30000};
sandbox.DCM_ACTION_REASONS={'01':'ERP/시스템 미구축'};
sandbox.DCM_BASE_DATA=[];
sandbox.addEventListener=()=>{};
sandbox.dispatchEvent=()=>{};
vm.createContext(sandbox);
vm.runInContext(injected,sandbox);
sandbox.__syncHarness.start();
const el=id=>{
 const x=get(id);assert.ok(x,'Missing Sync UI '+id);return x;
};
assert.equal(requests.length,0,'Never silently authenticate with browser-stored legacy key');
assert.equal(localStorage.getItem('dcm-action-sync-key'),null,'Legacy key must be removed');
assert.equal(el('ctSyncConnect').textContent,'로그인');
assert.equal(el('ctSyncPinRow').hidden,true);
assert.equal(get('ctReasonRepair'),null,'Obsolete H-column repair control remains');

const click=async id=>{
 const fn=el(id).events.get('click');assert.equal(typeof fn,'function',id+' has no click handler');
 return await fn();
};
el('ctSyncKey').value='wrong-key';
await click('ctSyncConnect');
assert.equal(requests.at(-1).type,'syncLogin');
assert.equal(requests.at(-1).token,'wrong-key');
assert.match(el('ctSyncStatus').textContent,/공유키 로그인 실패/);
assert.match(el('ctSyncMeta').textContent,/공유키/);
assert.equal(sessionStorage.getItem('dcm-action-sync-session-token'),null);
assert.equal(sandbox.DCMActionSync.isConnected(),false);
assert.equal(el('ctSyncConnect').textContent,'로그인');
assert.ok(!requests.some(v=>v.type==='repairReasonValidation'));

mode='http404';el('ctSyncKey').value='case-404';
await click('ctSyncConnect');
assert.match(el('ctSyncStatus').textContent,/배포 주소 오류/);
assert.equal(sandbox.DCMActionSync.isConnected(),false);

mode='correct';el('ctSyncKey').value='valid-read-key';
await click('ctSyncConnect');
assert.equal(sandbox.DCMActionSync.isConnected(),true);
assert.equal(el('ctSyncConnect').textContent,'로그아웃');
assert.equal(el('ctSyncKey').hidden,true);
assert.equal(el('ctSyncEditAuth').hidden,false);
assert.equal(el('ctSyncPinRow').hidden,true);
assert.equal(sessionStorage.getItem('dcm-action-sync-session-token'),'valid-read-key');
assert.equal(localStorage.getItem('dcm-action-sync-key'),null);
await click('ctSyncEditAuth');
assert.equal(el('ctSyncPinRow').hidden,false);
el('ctSyncEditorPin').value='fake-editor-pin';
await click('ctSyncPinApply');
assert.equal(sessionStorage.getItem('dcm-sync-editor-pin-session'),'fake-editor-pin');
assert.equal(el('ctSyncPinRow').hidden,true);
assert.match(el('ctSyncStatus').textContent,/실제 저장 시 서버에서 인증/);
await click('ctSyncConnect');
assert.equal(sandbox.DCMActionSync.isConnected(),false);
assert.equal(sessionStorage.getItem('dcm-action-sync-session-token'),null);
assert.equal(sessionStorage.getItem('dcm-sync-editor-pin-session'),null);

// Successful read login must not upload unsent edits or replace cached changes.
const pendingKey='dcm-action-master-pending-v1',actionKey='dcm-dashboard-v10-actions';
const edit={key:'백제약품 대전|||123',changedFields:['plan'],plan:'보존해야 할 수정'};
localStorage.map.set(pendingKey,JSON.stringify([edit]));
localStorage.map.set(actionKey,JSON.stringify([{key:edit.key,plan:'보존해야 할 수정'}]));
const before=localStorage.getItem(actionKey);
requests=[];
el('ctSyncKey').value='valid-read-key';
await click('ctSyncConnect');
assert.equal(sandbox.DCMActionSync.isConnected(),true);
assert.equal(el('ctSyncSavePending').hidden,false);
assert.equal(localStorage.getItem(actionKey),before,'Login overwrote unsent local edits');
assert.ok(requests.some(x=>x.type==='syncLogin'),'Login must authenticate before loading data');
assert.ok(requests.some(x=>x.type==='load'),'Login must load shared Actions after authentication');
assert.ok(!requests.some(x=>x.type==='save'),'Login silently made write or snapshot calls');
assert.match(el('ctSyncMeta').textContent,/미전송 수정/);
console.log('PASS SYNC LOGIN: explicit click, wrong-key/404, session-only secret, scoped edit PIN, pending edits preserved, no H repair');
