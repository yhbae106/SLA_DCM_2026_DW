import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ACTION='dcm-dashboard-v10-actions',PENDING='dcm-action-master-pending-v1';
const TOKEN='dcm-action-sync-session-token',VERSION='20261008-seven-reasons-fast-v3';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const receipt=json=>({ok:true,status:200,json:async()=>json});
const load=actions=>({ok:true,version:VERSION,actions,revision:'remote-revision'});
const action=plan=>({key:'업체 A|||1',outlet:'업체 A',businessNo:'1',businessName:'검증 거래처',manager:'정직한',plan,status:'IN_PROGRESS'});
function fixture(){
 class Store{
  constructor(){this.map=new Map();}
  getItem(key){return this.map.get(key)??null;}
  setItem(key,value){this.map.set(key,String(value));}
  removeItem(key){this.map.delete(key);}
 }
 const localStorage=new Store(),sessionStorage=new Store(),nodes=new Map(),timers=new Map(),requests=[],events=[];
 let timerId=0,fetcher=async payload=>receipt(payload.type==='load'?load([]):{ok:true,version:VERSION,changedRows:1});
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,className:'',dataset:{},
   classList:{add(){},remove(){},toggle(){}},querySelector(){return null;},addEventListener(){},focus(){},closest(){return null;}});
  return nodes.get(id);
 };
 node('month').value='2026-09';node('manager').value='전체';node('outlet').value='전체';
 const ctx={console:{warn(){}},Storage:Store,localStorage,sessionStorage,AbortController,
  document:{readyState:'loading',visibilityState:'visible',activeElement:null,getElementById:node,querySelectorAll(){return [];},addEventListener(){}},
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  setInterval(){return ++timerId;},clearInterval(){},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  MutationObserver:class{observe(){}},addEventListener(){},dispatchEvent:e=>events.push(e),
  fetch:(_url,options)=>{const payload=JSON.parse(options.body);requests.push({payload,signal:options.signal});return fetcher(payload,options);},
  DCM_ACTION_SYNC:{endpoint:'https://example.test/exec',editors:['정직한'],pollMs:30000},
  DCM_BASE_DATA:[{month:'2026-09',outlet:'업체 A',businessNo:'1',businessName:'검증 거래처',manager:'정직한',statuses:{'대웅제약':'X','대웅바이오':null,'한올바이오':null}}]};
 ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('logic.js','utf8'),ctx);
 const source=fs.readFileSync('action-sync.js','utf8'),hook='window.DCMActionSync={';assert.ok(source.includes(hook));
 vm.runInContext(source.replace(hook,`window.testActionSync={post,quickLogin,signInFromButton,logoutSync,pullRemote,flushPendingEdits,
  pendingEdits,pushRiskSnapshot,scheduleRiskSnapshot,
  state:()=>({signedIn,serverReady,loginBusy,flushingPending,lastRevision,lastPullAt}),
  authenticate:(key='test-key')=>{sessionStorage.setItem(SESSION_TOKEN_KEY,key);sessionStorage.setItem(EDITOR_PIN_SESSION,'test-pin');signedIn=true;serverReady=true;},
 };`+hook),ctx);
 localStorage.map.set('dcm-action-sync-editor','정직한');
 return {ctx,api:ctx.testActionSync,node,timers,requests,events,localStorage,sessionStorage,
  network:fn=>{fetcher=fn;},seed:rows=>localStorage.map.set(ACTION,JSON.stringify(rows)),
  write:rows=>localStorage.setItem(ACTION,JSON.stringify(rows)),rows:()=>JSON.parse(localStorage.getItem(ACTION)||'[]')};
}

// The real POST wrapper must reject responses from an ended session even when
// transport ignores AbortController, and also after response-body parsing began.
{
 const f=fixture(),pending=deferred();f.api.authenticate();f.network(()=>pending.promise);
 const call=f.api.post({type:'syncLogin'});f.api.logoutSync();
 assert.equal(f.requests[0].signal.aborted,true);
 pending.resolve(receipt({ok:true,version:VERSION}));await assert.rejects(call,error=>error.stale===true);
 assert.equal(f.api.state().signedIn,false);assert.equal(f.sessionStorage.getItem(TOKEN),null);
}
{
 const f=fixture(),body=deferred();f.api.authenticate();f.network(async()=>({ok:true,json:()=>body.promise}));
 const call=f.api.post({type:'load'});await Promise.resolve();f.api.logoutSync();
 body.resolve(load([action('늦은 응답')]));await assert.rejects(call,error=>error.stale===true);
 assert.equal(f.api.state().signedIn,false);
}
{
 const f=fixture(),old=deferred(),next=deferred();let logins=0;
 f.network(payload=>payload.type==='syncLogin'?(++logins===1?old.promise:next.promise):Promise.resolve(receipt(load([]))));
 f.node('ctSyncKey').value='old-key';const first=f.api.signInFromButton();f.api.logoutSync();
 f.node('ctSyncKey').value='new-key';const second=f.api.signInFromButton();
 old.resolve(receipt({ok:true,version:VERSION}));await first;
 assert.equal(f.api.state().signedIn,false);assert.equal(f.api.state().loginBusy,true);
 assert.equal(f.node('ctSyncConnect').disabled,true);assert.equal(f.sessionStorage.getItem(TOKEN),'new-key');
 next.resolve(receipt({ok:true,version:VERSION}));await second;await settle();
 assert.equal(f.api.state().signedIn,true);assert.equal(f.api.state().loginBusy,false);
 assert.equal(f.requests.filter(r=>r.payload.type==='load').length,1,'Retired login must not start a load');
 assert.equal(f.requests.filter(r=>r.payload.type==='save').length,0,'Login must not write Actions or metadata');
}

// A shared in-flight read cannot be duplicated; a valid empty snapshot is still
// authoritative, while a missing, malformed, or duplicate-key array is rejected.
{
 const f=fixture(),pending=deferred();f.api.authenticate();f.seed([action('이전 값')]);f.network(()=>pending.promise);
 const first=f.api.pullRemote(true),second=f.api.pullRemote(true);
 assert.equal(first,second);assert.equal(f.requests.length,1);
 pending.resolve(receipt(load([])));assert.equal(await first,true);
 assert.equal(f.rows().length,0);assert.match(f.node('ctSyncStatus').textContent,/0건 확인/);
 assert.equal(f.events.filter(e=>e.type==='dcm-action-sync-applied').length,1);
}
for(const invalid of [undefined,null,{},[null],[{key:'bad'}],[action('A'),action('B')],[{...action('A'),status:'UNKNOWN'}]]){
 const f=fixture();f.api.authenticate();f.seed([action('유지할 정상 자료')]);
 f.network(async()=>receipt(load(invalid)));
 assert.equal(await f.api.pullRemote(true),false);assert.equal(f.rows()[0].plan,'유지할 정상 자료');
 assert.match(f.node('ctSyncStatus').textContent,/이전 자료 유지/);assert.equal(f.api.state().lastPullAt,0);
}

// Staging occurs synchronously with the actual application Storage.setItem hook.
// An earlier read cannot overwrite edits, including after their save completes.
{
 const f=fixture(),pending=deferred();f.api.authenticate();f.seed([action('이전 값')]);f.network(()=>pending.promise);
 const first=f.api.pullRemote(true);f.write([action('새 입력')]);
 assert.equal(f.api.pendingEdits()[0].plan,'새 입력','No 80ms window may leave local edits unstaged');
 pending.resolve(receipt(load([action('읽기 시작 시점 값')])));assert.equal(await first,true);
 assert.equal(f.rows()[0].plan,'새 입력');assert.equal(f.api.pendingEdits().length,1);
 assert.match(f.node('ctSyncStatus').textContent,/미전송 수정/);
}
{
 const f=fixture(),old=deferred();f.api.authenticate();f.seed([action('이전 값')]);let reads=0;
 f.network(payload=>payload.type==='load'?(++reads===1?old.promise:Promise.resolve(receipt(load([action('확인된 새 값')])))):Promise.resolve(receipt({ok:true,changedRows:1})));
 const first=f.api.pullRemote(true);f.write([action('확인된 새 값')]);assert.equal(await f.api.flushPendingEdits(),true);
 assert.equal(f.api.pendingEdits().length,0);
 old.resolve(receipt(load([action('저장 전 서버 값')])));await first;
 assert.equal(f.rows()[0].plan,'확인된 새 값');assert.equal(f.api.state().lastRevision,null,'Discarded read must not advance the polling revision');
 await f.api.pullRemote(true);assert.equal(f.api.state().lastRevision,'remote-revision');
}

// The save acknowledgement is the current master API's changedRows count. Zero
// is a valid idempotent/no-change receipt; strings, missing/negative/oversize or
// fractional counts do not confirm a write or delete pending values.
for(const changedRows of [undefined,-1,2,0.5,'1',NaN]){
 const f=fixture();f.api.authenticate();f.seed([action('이전 값')]);f.write([action('미전송 값')]);
 f.network(async()=>receipt({ok:true,changedRows}));
 assert.equal(await f.api.flushPendingEdits(),false);assert.equal(f.api.pendingEdits()[0].plan,'미전송 값');
 assert.match(f.node('ctSyncStatus').textContent,/저장 확인 필요/);assert.equal(f.api.state().flushingPending,false);
}
for(const changedRows of [0,1]){
 const f=fixture();f.api.authenticate();f.seed([action('이전 값')]);f.write([action('저장 값')]);
 f.network(async()=>receipt({ok:true,changedRows}));
 assert.equal(await f.api.flushPendingEdits(),true);assert.equal(f.api.pendingEdits().length,0);
 assert.match(f.node('ctSyncStatus').textContent,/저장 확인/);
}

// A changed field typed while the previous batch is pending stays staged, then
// drains as a second serial save. Repeated triggers never duplicate the batch.
{
 const f=fixture(),firstReceipt=deferred(),secondReceipt=deferred();let saves=0;
 f.api.authenticate();f.seed([action('이전 값')]);f.write([action('첫 입력')]);
 f.network(()=>++saves===1?firstReceipt.promise:secondReceipt.promise);
 const saving=f.api.flushPendingEdits();f.write([{...action('그 후 입력'),status:'DONE'}]);
 assert.equal(await f.api.flushPendingEdits(),false);
 for(const timer of [...f.timers.values()].filter(t=>t.ms===80))timer.fn();
 assert.equal(saves,1);assert.equal(f.api.pendingEdits()[0].plan,'그 후 입력');
 firstReceipt.resolve(receipt({ok:true,changedRows:1}));await settle();
 assert.equal(saves,2);assert.equal(f.requests[1].payload.actions[0].plan,'그 후 입력');
 assert.equal(f.requests[1].payload.actions[0].status,'DONE');assert.equal(f.api.state().flushingPending,true);
 secondReceipt.resolve(receipt({ok:true,changedRows:1}));assert.equal(await saving,true);
 assert.equal(f.api.pendingEdits().length,0);assert.equal(f.rows()[0].plan,'그 후 입력');
 assert.equal(f.api.state().flushingPending,false);
}
{
 const f=fixture(),old=deferred(),next=deferred();let saves=0;
 f.api.authenticate();f.seed([action('이전 값')]);f.write([action('동일한 입력')]);
 f.network(()=>++saves===1?old.promise:next.promise);
 const first=f.api.flushPendingEdits();f.api.logoutSync();f.api.authenticate('new-key');
 const second=f.api.flushPendingEdits();old.resolve(receipt({ok:true,changedRows:1}));assert.equal(await first,false);
 assert.equal(f.api.pendingEdits().length,1);assert.equal(f.api.state().flushingPending,true,'Retired finally cannot unlock a newer save');
 next.resolve(receipt({ok:true,changedRows:1}));assert.equal(await second,true);assert.equal(f.api.pendingEdits().length,0);
}

// Logout clears a scheduled metadata snapshot. Already queued edit callbacks are
// harmless after relogin, and a retired metadata response cannot cache success.
{
 const f=fixture();f.api.authenticate();f.seed([action('이전 값')]);f.write([action('보관 입력')]);
 const delayedEdit=[...f.timers.values()].find(t=>t.ms===80);assert.ok(delayedEdit);
 f.api.scheduleRiskSnapshot(600,true);const snapshot=[...f.timers].find(([,t])=>t.ms===600);assert.ok(snapshot);
 f.api.logoutSync();assert.equal(f.timers.has(snapshot[0]),false);f.api.authenticate('new-key');delayedEdit.fn();await settle();
 assert.equal(f.requests.length,0);assert.equal(f.api.pendingEdits().length,1);
}
{
 const f=fixture(),pending=deferred();f.api.authenticate();f.seed([action('이전 값')]);f.network(()=>pending.promise);
 const call=f.api.pushRiskSnapshot(true);assert.equal(f.requests[0].payload.mode,'snapshot');f.api.logoutSync();
 pending.resolve(receipt({ok:true,changedRows:1}));await call;
 assert.equal(f.sessionStorage.getItem('dcm-action-sync-risk-hash'),null);
 assert.equal(f.api.state().signedIn,false);
}
{
 const f=fixture(),pending=deferred();f.api.authenticate();f.seed([action('이전 값')]);f.write([action('보관 입력')]);
 f.network(()=>pending.promise);const before=f.node('ctSyncStatus').textContent;
 const call=f.api.pushRiskSnapshot(true);pending.resolve(receipt({ok:true,changedRows:1}));await call;
 assert.equal(f.api.pendingEdits().length,1);assert.equal(f.node('ctSyncStatus').textContent,before,'Metadata sync must not claim the pending user edit was saved');
}
for(const changedRows of [undefined,-1,2]){
 const f=fixture();f.api.authenticate();f.seed([action('이전 값')]);f.network(async()=>receipt({ok:true,changedRows}));
 await f.api.pushRiskSnapshot(true);
 assert.equal(f.sessionStorage.getItem('dcm-action-sync-risk-hash'),null,'Unconfirmed snapshot must remain eligible for retry');
 assert.match(f.node('ctSyncStatus').className,/error/);
}
console.log('PASS ACTION LIFECYCLE: retired transport/login/save isolation, deduplicated reads, strict/empty snapshots, immediate staging, stale-read epochs, changedRows receipts, serial newer edits and canceled metadata timers');
