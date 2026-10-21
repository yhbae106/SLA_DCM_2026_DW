import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(file,'utf8');
const DATA_KEY='dcm-dashboard-v8-data';
const MASTER_KEY='dcm-dashboard-master-password';
const COMMITTED='dcm-dashboard-data-committed';
const clone=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const row=(businessNo='100',businessName='Original')=>({
 month:'2026-09',outlet:'Fixture partner',manager:'Fixture manager',businessNo,businessName,
 statuses:{'대웅제약':'X','대웅바이오':null,'한올바이오':'O'}
});
const initial=[row()];

class Store{
 constructor(){this.map=new Map();this.failWrites=false;}
 getItem(key){return this.map.has(key)?this.map.get(key):null;}
 setItem(key,value){if(this.failWrites&&key===DATA_KEY)throw new Error('Storage quota exceeded');this.map.set(key,String(value));}
 removeItem(key){this.map.delete(key);}
}
class Event{
 constructor(type,options={}){this.type=type;this.detail=options.detail;this.defaultPrevented=false;}
 preventDefault(){this.defaultPrevented=true;}
 stopImmediatePropagation(){this.stopped=true;}
}
class Target{
 constructor(){this.events=new Map();}
 addEventListener(name,callback,options={}){
  if(!this.events.has(name))this.events.set(name,[]);
  this.events.get(name).push({callback,once:options?.once});
 }
 removeEventListener(name,callback){this.events.set(name,(this.events.get(name)||[]).filter(x=>x.callback!==callback));}
 dispatchEvent(event){
  event.target??=this;event.results=[];
  for(const item of [...(this.events.get(event.type)||[])]){
   if(item.once)this.removeEventListener(event.type,item.callback);
   event.results.push(item.callback(event));if(event.stopped)break;
  }
  return !event.defaultPrevented;
 }
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function timers(){
 let now=0,next=1;const pending=new Map();
 return {
  setTimeout(fn,delay=0,...args){const id=next++;pending.set(id,{at:now+delay,fn:()=>fn(...args)});return id;},
  clearTimeout(id){pending.delete(id);},
  advance(ms){
   const until=now+ms;
   for(let count=0;;count++){
    const due=[...pending].filter(([,task])=>task.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;assert.ok(count<1000,'Unexpected timer loop');
    pending.delete(due[0]);now=due[1].at;due[1].fn();
   }
   now=until;
  }
 };
}
function browser({honorAbort=false}={}){
 const nodes=new Map(),clock=timers(),windowEvents=new Target();
 const makeNode=(id='')=>{
  const node=new Target(),classes=new Set();let html='';
  Object.assign(node,{id,value:'',textContent:'',className:'',dataset:{},style:{},hidden:false,disabled:false,files:[],children:[],
   classList:{add(...values){values.forEach(x=>classes.add(x));},remove(...values){values.forEach(x=>classes.delete(x));},toggle(value,on){const enabled=on??!classes.has(value);enabled?classes.add(value):classes.delete(value);return enabled;},contains(value){return classes.has(value);}},
   appendChild(child){this.children.push(child);child.parentNode=this;if(child.id)nodes.set(child.id,child);return child;},
   insertAdjacentElement(_where,child){if(child.id)nodes.set(child.id,child);return child;},
   querySelector(query){return query.startsWith('#')?nodes.get(query.slice(1))||null:null;},
   querySelectorAll(){return [];},closest(query){return query==='.uploadbox'?uploadBox:null;},
   setAttribute(name,value){this[name]=String(value);},removeAttribute(name){delete this[name];},focus(){},click(){this.dispatchEvent(new Event('click'));}
  });
  Object.defineProperty(node,'innerHTML',{get(){return html;},set(value){html=String(value);for(const m of html.matchAll(/\bid=["']([^"']+)["']/g))if(!nodes.has(m[1]))nodes.set(m[1],makeNode(m[1]));}});
  return node;
 };
 const uploadBox=makeNode(),filters=makeNode(),main=makeNode();
 for(const m of read('index.html').matchAll(/\bid=["']([^"']+)["']/g))nodes.set(m[1],makeNode(m[1]));
 const document=new Target();
 Object.assign(document,{readyState:'complete',visibilityState:'visible',head:makeNode(),body:makeNode(),
  getElementById:id=>nodes.get(id)||null,createElement:()=>makeNode(),
  querySelector:query=>query==='.panel.filters'?filters:query==='main.wrap'?main:query.startsWith('#')?nodes.get(query.slice(1))||null:null,
  querySelectorAll:()=>[]
 });
 const localStorage=new Store(),sessionStorage=new Store(),requests=[],emitted=[],alerts=[];
 localStorage.setItem(DATA_KEY,JSON.stringify(initial));let reloads=0;
 const sandbox={document,localStorage,sessionStorage,Storage:Store,CustomEvent:Event,AbortController,DOMException,
  setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,setInterval:()=>1,clearInterval(){},
  location:{reload(){reloads++;}},console:{warn(){},error(){},info(){},log(){}},
  alert:message=>alerts.push(String(message)),confirm:()=>true,
  DCM_ACTION_SYNC:{endpoint:'https://example.test/exec'},
  DCM_CONFIG:{outlets:['Fixture partner'],managers:['Fixture manager'],managerByOutlet:{'Fixture partner':'Fixture manager'}},
  DCM_BASE_DATA:clone(initial),
  fetch:(_url,options)=>{
   const result=deferred(),request={payload:JSON.parse(options.body),options,...result,settled:false,taken:false};
   requests.push(request);
   if(honorAbort)options.signal?.addEventListener('abort',()=>{request.settled=true;result.reject(new DOMException('Aborted','AbortError'));},{once:true});
   return result.promise;
  },
  addEventListener:windowEvents.addEventListener.bind(windowEvents),removeEventListener:windowEvents.removeEventListener.bind(windowEvents),
  dispatchEvent(event){emitted.push(event);return windowEvents.dispatchEvent(event);}
 };
 sandbox.window=sandbox;sandbox.globalThis=sandbox;
 vm.createContext(sandbox);vm.runInContext(read('dashboard-data.js'),sandbox);
 const fixture={sandbox,nodes,clock,localStorage,sessionStorage,requests,emitted,alerts,
  get reloads(){return reloads;},
  el(id){const node=nodes.get(id);assert.ok(node,'Missing fixture element '+id);return node;},
  fire(id,type='click'){
   const event=new Event(type);this.el(id).dispatchEvent(event);return Promise.all(event.results);
  },
  take(type){const request=requests.find(x=>x.payload.type===type&&!x.taken);assert.ok(request,'Missing request '+type);request.taken=true;return request;},
  async answer(request,body){request.settled=true;request.resolve({ok:true,status:200,json:async()=>clone(body)});await tick();},
  rows(){return JSON.parse(localStorage.getItem(DATA_KEY));},
  setRows(rows){localStorage.setItem(DATA_KEY,JSON.stringify(rows));},
  commit(source='excel'){sandbox.dispatchEvent(new Event(COMMITTED,{detail:{source,rowCount:this.rows().length,committedAt:new Date().toISOString()}}));}
 };
 return fixture;
}
async function masterFixture(options){
 const fixture=browser(options);
 vm.runInContext(read('master-data-sync.js'),fixture.sandbox);
 fixture.clock.advance(200);await tick();
 assert.equal(typeof fixture.sandbox.DCMMasterSync?.logout,'function','Master lifecycle API missing');
 fixture.api=fixture.sandbox.DCMMasterSync;return fixture;
}
async function authenticate(fixture){
 fixture.el('masterPassword').value='fixture-only-password';
 const signingIn=fixture.fire('masterLoginBtn');
 await fixture.answer(fixture.take('masterLogin'),{ok:true});
 await fixture.answer(fixture.take('dashboardMaster'),{ok:true,data:clone(initial),updatedAt:'2026-10-21T00:00:00Z'});
 await signingIn;assert.equal(fixture.api.isMaster(),true);return fixture;
}

// Ignore AbortSignal in this fetch double: even a response that escapes cancellation must be inert.
{
 const f=await masterFixture();f.el('masterPassword').value='fixture-only-password';
 const signingIn=f.fire('masterLoginBtn'),request=f.take('masterLogin');
 f.api.logout();const status=f.el('masterSyncStatus').textContent;
 assert.equal(request.options.signal?.aborted,true,'Logout must abort the owned login request');
 await f.answer(request,{ok:true});await signingIn;
 assert.equal(f.api.isMaster(),false,'A late login restored master privileges after logout');
 assert.equal(f.sessionStorage.getItem(MASTER_KEY),null,'A late login restored credentials');
 assert.equal(f.el('masterSyncStatus').textContent,status,'A retired login changed current status');
 assert.equal(f.requests.filter(x=>x.payload.type==='dashboardMaster').length,0,'Retired login started a read');
 assert.equal(f.emitted.filter(x=>x.type==='dcm-master-authenticated').length,0);
}

{
 const f=await authenticate(await masterFixture()),newer=[row('100','New local import')];
 const pulling=f.api.pull(),request=f.take('dashboardMaster');
 f.setRows(newer);await f.answer(request,{ok:true,data:[row('100','Older remote data')]});await pulling;
 assert.deepEqual(f.rows(),newer,'A delayed shared read overwrote newer local data');
 assert.equal(f.reloads,0,'A discarded response reloaded the page');
 const accepted=[row('100','Confirmed shared data')],next=f.api.pull();
 await f.answer(f.take('dashboardMaster'),{ok:true,data:accepted});await next;
 assert.deepEqual(f.rows(),accepted,'An unchanged local revision should accept a valid shared read');
 assert.equal(f.reloads,1);
}

{
 const f=await authenticate(await masterFixture()),confirmed=[row('100','Recovered shared data')];
 f.localStorage.setItem(DATA_KEY,'{damaged-cache');
 const pulling=f.api.pull();await f.answer(f.take('dashboardMaster'),{ok:true,data:confirmed});await pulling;
 assert.equal(f.localStorage.getItem(DATA_KEY),JSON.stringify(confirmed),'A valid shared read must repair malformed local cache');
 assert.equal(f.reloads,1);
}

{
 const f=await authenticate(await masterFixture());
 const a=[row('100','First save')],b=[row('100','Intermediate save')],c=[row('100','Latest save')];
 f.setRows(a);const first=f.api.save(),request=f.take('saveDashboard');
 f.setRows(b);const second=f.api.save();f.setRows(c);const third=f.api.save();
 assert.equal(f.requests.filter(x=>x.payload.type==='saveDashboard').length,1,'Writes overlapped');
 assert.deepEqual(request.payload.data,a);
 await f.answer(request,{ok:true,rowCount:1,updatedAt:'2026-10-21T00:01:00Z'});
 const latest=f.take('saveDashboard');assert.deepEqual(latest.payload.data,c,'Queued writes did not coalesce to the latest snapshot');
 assert.notEqual(f.el('masterSyncStatus').dataset.state,'ok','The latest save is still unconfirmed');
 await f.answer(latest,{ok:true,rowCount:1,updatedAt:'2026-10-21T00:02:00Z'});
 await Promise.all([first,second,third]);
 assert.equal(f.requests.filter(x=>x.payload.type==='saveDashboard').length,2);
 assert.deepEqual(f.rows(),c);assert.equal(f.el('masterSyncStatus').dataset.state,'ok');
 assert.doesNotMatch(f.el('masterSyncStatus').textContent,/파트너 화면에도 반영/,'Server acknowledgement cannot confirm another browser rendered it');
}

{
 const f=await authenticate(await masterFixture());
 const invalid=[undefined,{},[null],[{...row(),month:'2026-13'}],[{...row(),outlet:''}],[{...row(),businessNo:''}],
  [{...row(),statuses:{'대웅제약':'UNKNOWN'}}],[row(),row()]];
 for(const data of invalid){
  const previous=f.rows(),pulling=f.api.pull(),body={ok:true};if(data!==undefined)body.data=data;
  await f.answer(f.take('dashboardMaster'),body);await pulling;
  assert.deepEqual(f.rows(),previous,'Invalid shared data replaced the last usable snapshot');
  assert.equal(f.el('masterSyncStatus').dataset.state,'error','Invalid shared data appeared successful');
  assert.equal(f.reloads,0);
 }
 const empty=f.api.pull();await f.answer(f.take('dashboardMaster'),{ok:true,data:[]});await empty;
 assert.deepEqual(f.rows(),initial,'An empty uninitialized shared dashboard erased local data');
 assert.notEqual(f.el('masterSyncStatus').dataset.state,'error','Empty shared data is a valid uninitialized state');
 const sent=f.requests.filter(x=>x.payload.type==='saveDashboard').length;
 for(const raw of ['{invalid',JSON.stringify({data:initial}),JSON.stringify([row(),row()])]){
  f.localStorage.setItem(DATA_KEY,raw);await f.api.save();
  assert.equal(f.requests.filter(x=>x.payload.type==='saveDashboard').length,sent,'Invalid local data was published');
  assert.equal(f.el('masterSyncStatus').dataset.state,'error');
 }
}

{
 const f=await authenticate(await masterFixture());
 f.el('fileInput').files=[{name:'slow-import.xlsx'}];await f.fire('fileInput','change');
 f.clock.advance(5000);await tick();
 assert.equal(f.requests.filter(x=>x.payload.type==='saveDashboard').length,0,'File selection or a heuristic timer published old data');
 f.commit('backup');f.commit('reset');await tick();
 assert.equal(f.requests.filter(x=>x.payload.type==='saveDashboard').length,0,'Local backup/reset previews require an explicit shared save');
 const committed=[row('200','Committed Excel data')];f.setRows(committed);f.commit();await tick();
 const saved=f.take('saveDashboard');assert.deepEqual(saved.payload.data,committed);
 await f.answer(saved,{ok:true,rowCount:1});
 f.api.logout();const before=f.requests.length;f.commit();await tick();
 assert.equal(f.requests.length,before,'A commit event published data without a master session');
}

{
 const f=await masterFixture({honorAbort:true});f.el('masterPassword').value='fixture-only-password';
 const signingIn=f.fire('masterLoginBtn'),request=f.take('masterLogin');
 f.clock.advance(60000);await tick();await signingIn;
 assert.equal(request.options.signal?.aborted,true,'Stalled requests need a deadline');
 assert.equal(f.api.isMaster(),false);assert.equal(f.el('masterSyncStatus').dataset.state,'error');
}

function appFixture(){
 const fixture=browser();let generation=1;
 fixture.sandbox.DCMMasterSync={isMaster:()=>true,generation:()=>generation};
 fixture.retireSession=()=>{generation++;};
 fixture.sandbox.XLSX={read:workbook=>workbook,utils:{sheet_to_json:sheet=>sheet}};
 vm.runInContext(read('logic.js'),fixture.sandbox);vm.runInContext(read('app.js'),fixture.sandbox);
 fixture.commits=[];fixture.sandbox.addEventListener(COMMITTED,event=>fixture.commits.push({detail:clone(event.detail),rows:fixture.rows()}));
 return fixture;
}
function workbook(businessNo){return {SheetNames:['Fixture partner'],Sheets:{'Fixture partner':[
 ['회사','도도매명','사업자번호','연동'],['대웅제약','Imported '+businessNo,businessNo,'O']
]}};}
function file(buffer,name='2026-09-fixture.xlsx'){return {name,arrayBuffer:()=>buffer.promise};}

{
 const f=appFixture(),first=deferred(),second=deferred();
 f.el('fileInput').files=[file(first),file(second)];const importing=f.fire('fileInput','change');
 await tick();first.resolve(workbook('201'));await tick();f.clock.advance(5000);
 assert.deepEqual(f.rows(),initial,'The first file committed before the full batch parsed');
 assert.equal(f.commits.length,0,'A partial import emitted a committed-data event');
 second.resolve(workbook('202'));await importing;
 assert.equal(f.commits.length,1,'A successful batch must emit exactly one commit event');
 assert.deepEqual(f.rows().map(x=>x.businessNo).sort(),['201','202']);
 assert.deepEqual(f.commits[0].rows,f.rows(),'Commit event preceded durable local storage');
 assert.equal(f.commits[0].detail.source,'excel');assert.equal(f.commits[0].detail.rowCount,2);
 assert.ok(Number.isFinite(Date.parse(f.commits[0].detail.committedAt)),'Commit event needs a parseable timestamp');
}

{
 const f=appFixture(),first=deferred(),second=deferred();
 f.el('fileInput').files=[file(first),file(second)];const importing=f.fire('fileInput','change');
 first.resolve(workbook('201'));await tick();second.reject(new Error('Broken workbook'));await importing;
 assert.deepEqual(f.rows(),initial,'A failed batch committed a partial import');
 assert.equal(f.commits.length,0,'A failed parse emitted a successful commit');assert.ok(f.alerts.length>0);
}

{
 const f=appFixture(),buffer=deferred();f.localStorage.failWrites=true;
 f.el('fileInput').files=[file(buffer)];const importing=f.fire('fileInput','change');
 buffer.resolve(workbook('201'));await importing;
 assert.deepEqual(f.rows(),initial);assert.equal(f.commits.length,0,'A failed local save emitted a successful commit');
 assert.ok(f.alerts.length>0);
}

{
 const f=appFixture(),buffer=deferred();f.el('fileInput').files=[file(buffer)];
 const importing=f.fire('fileInput','change');await tick();f.retireSession();buffer.resolve(workbook('201'));await importing;
 assert.deepEqual(f.rows(),initial,'An import from a retired master session committed after re-login');
 assert.equal(f.commits.length,0);
}

console.log('PASS DATA LIFECYCLE: retired sessions, read conflicts, coalesced saves, schema rejection, explicit commit events, deadlines, atomic Excel batches');
