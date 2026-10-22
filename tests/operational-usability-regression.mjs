import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const inject=(source,hook)=>{const i=source.lastIndexOf('})();');assert.ok(i>=0);return source.slice(0,i)+hook+'\n'+source.slice(i);};
const DATA='dcm-dashboard-v8-data',SCOPE='dcm-dashboard-scope-v1';
const statuses=(a,b=null,c=null)=>({'대웅제약':a,'대웅바이오':b,'한올바이오':c});
const data=[];
for(const month of ['2026-08','2026-09']){
 for(let i=0;i<61;i++)data.push({month,outlet:'A유통',manager:'담당A',businessNo:i===0?'00123':String(i+1000),businessName:i===0?' =HYPERLINK("bad")':'가나다약품 '+i,statuses:statuses('X')});
 data.push({month,outlet:'B유통',manager:'담당B',businessNo:'00123',businessName:'다른 업체',statuses:statuses('X')});
 data.push({month,outlet:'C유통',manager:'담당B',businessNo:'99999',businessName:'평가 없음',statuses:statuses(null)});
}
function fixture(saved){
 const nodes=new Map(),events=new Map(),memory=new Map([[DATA,JSON.stringify(data)]]),session=new Map(saved?[[SCOPE,JSON.stringify(saved)]]:[]),downloads=[];
 const store=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 const create=(id='')=>{
  const handlers=new Map(),attrs=new Map();let html='';
  const node={id,value:'',textContent:'',dataset:{},style:{},disabled:false,hidden:false,scrolled:0,children:[],
   classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],querySelector:()=>null,closest:()=>null,
   setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),scrollIntoView(){this.scrolled++;},focus(){},
   addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},
   dispatchEvent(event){event.target??=this;for(const fn of handlers.get(event.type)||[])fn(event);return true;},
   click(){this.dispatchEvent({type:'click',target:this});},appendChild(child){this.children.push(child);return child;}
  };
  Object.defineProperty(node,'innerHTML',{get:()=>html,set:v=>{html=String(v);}});
  Object.defineProperty(node,'options',{get:()=>[...html.matchAll(/<option(?: value="([^"]*)")?[^>]*>([^<]*)<\/option>/g)].map(([,value,label])=>({value:value??label,textContent:label,remove(){}}))});
  return node;
 };
 for(const m of read('index.html').matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],create(m[1]));
 for(const id of ['ctAction','ctActionShown','ctActionMore','ctActionAll'])nodes.set(id,create(id));
 for(const id of ['ctActionView','ctActionDetail','changeType'])nodes.get(id).innerHTML=read('index.html').match(new RegExp('<select id="'+id+'"[^>]*>([\\s\\S]*?)<\\/select>'))?.[1]||'';
 nodes.get('ctActionView').value='supply';nodes.get('ctActionDetail').value='all';nodes.get('changeType').value='new';
 const env={console,Event:class {constructor(type,options={}){this.type=type;Object.assign(this,options);}},CustomEvent:class {constructor(type,options={}){this.type=type;Object.assign(this,options);}},
  DCM_CONFIG:{managers:['담당A','담당B'],outlets:['A유통','B유통','C유통'],managerByOutlet:{A유통:'담당A',B유통:'담당B',C유통:'담당B'}},
  DCM_BASE_DATA:data,DCMDashboardData:{validate:r=>r,mark(){},describe:()=>''},DCMActionSync:{allRisk:()=>[],canEditFor:()=>false},DCM_ACTION_REASONS:{},
  localStorage:store(memory),sessionStorage:store(session),document:{readyState:'loading',getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},createElement:tag=>{const node=create();if(tag==='a')node.click=()=>downloads.push(node);return node;},head:create()},
  addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},dispatchEvent(e){for(const fn of events.get(e.type)||[])fn(e);},
  setTimeout:()=>1,clearTimeout(){},Blob:class {constructor(parts){this.text=parts.join('');}},URL:{createObjectURL:blob=>{env.lastBlob=blob;return 'blob:fixture';},revokeObjectURL(){}},alert(){},confirm:()=>false
 };
 env.window=env;env.globalThis=env;vm.createContext(env);vm.runInContext(read('logic.js'),env);
 vm.runInContext(inject(read('app.js'),'window.__app={commitData,render,refreshSelectors,restoreSelection};'),env);
 vm.runInContext(inject(read('control-tower-patch.js'),'window.__board={installAllXBoard,renderAllXActionBoard,actionCsv,scopeText};'),env);
 vm.runInContext(inject(read('dashboard-view-patch.js'),'window.__view={renderEntities,renderOutlets,rateStatus};'),env);
 vm.runInContext(inject(read('control-tower.js'),'window.__control={render};'),env);
 env.__board.installAllXBoard();
 return {env,nodes,memory,session,downloads,el:id=>nodes.get(id),change(id,value){nodes.get(id).value=value;nodes.get(id).dispatchEvent({type:'change'});env.__board.renderAllXActionBoard();},input(value){nodes.get('ctActionSearch').value=value;nodes.get('ctActionSearch').dispatchEvent({type:'input'});env.__board.renderAllXActionBoard();}};
}

{
 const f=fixture({manager:'담당A',outlet:'A유통',month:'2026-08'});
 assert.equal(f.el('manager').value,'담당A');assert.equal(f.el('outlet').value,'A유통');assert.equal(f.el('month').value,'2026-08');
 const next=[...data,{...data[0],month:'2026-10'}];f.env.__app.commitData(next,'excel');
 assert.equal(f.el('month').value,'2026-08','A new month must not replace a valid review month');
 assert.equal(f.el('outlet').value,'A유통');
 f.env.__app.commitData(next.filter(r=>r.month!=='2026-08'),'backup');
 assert.equal(f.el('month').value,'2026-10','Only an unavailable month falls back to latest');
 f.change('manager','전체');assert.equal(f.el('outlet').value,'A유통','Expanding manager scope keeps a valid outlet');
 f.change('manager','담당B');assert.equal(f.el('outlet').value,'전체','Incompatible outlet is cleared');
 f.change('outlet','B유통');f.change('manager','전체');assert.equal(f.el('outlet').value,'B유통');
 assert.equal(JSON.parse(f.session.get(SCOPE)).outlet,'B유통','Shared-data reload restores the same scope');
 console.log('PASS OPERATIONAL selection: upload/backup and reload retain valid month/manager/outlet, invalid choices alone reset');
}
{
 const f=fixture();f.change('manager','담당A');
 assert.equal(f.env.DCMUnifiedAction.selectOutlet('B유통'),false,'Drill-down must respect available manager outlets');
 assert.equal(f.env.DCMUnifiedAction.selectOutlet('A유통'),true);
 assert.equal(f.el('outlet').value,'A유통');assert.equal(f.el('ctActionView').value,'x');
 assert.ok(f.el('ctAction').scrolled>0);assert.match(f.el('ctActionScope').textContent,/2026-09 · 담당A · A유통/);
 assert.equal((f.el('ctActionBody').innerHTML.match(/<tr>/g)||[]).length,50,'Screen starts with first 50 rows');
 f.el('ctActionExport').click();assert.equal(f.env.lastBlob.text.charCodeAt(0),0xFEFF,'CSV needs UTF-8 BOM');
 assert.equal(f.env.lastBlob.text.split('\r\n').length,62,'Export includes all 61 matching rows, including beyond page 50');
 assert.ok(!f.env.lastBlob.text.includes('다른 업체'),'Export cannot include other outlets');
 assert.match(f.env.lastBlob.text,/"'00123"/,'Business ID must retain leading zeros as text');
 assert.match(f.env.lastBlob.text,/"' =HYPERLINK\(""bad""\)"/,'Formula-looking names are escaped');
 f.input('001-23');assert.match(f.el('ctActionCount').textContent,/^1처/);assert.match(f.el('ctActionScope').textContent,/검색: 001-23/);
 f.el('ctActionExport').click();assert.equal(f.env.lastBlob.text.split('\r\n').length,2,'Export respects normalized business-number search');
 f.input('없는 거래처');assert.equal(f.el('ctActionExport').disabled,true);assert.match(f.el('ctActionBody').innerHTML,/목록 조건을 초기화/);
 f.el('ctActionClear').click();assert.equal(f.el('ctActionSearch').value,'');assert.equal(f.el('month').value,'2026-09');assert.equal(f.el('outlet').value,'A유통','List reset preserves global scope');
 f.el('ctScopeReset').click();assert.equal(f.el('manager').value,'전체');assert.equal(f.el('outlet').value,'전체');assert.equal(f.el('month').value,'2026-09');
 console.log('PASS OPERATIONAL drill-down: scope labels, business-number search, empty recovery and complete filtered CSV');
}
{
 const f=fixture(),ctx={month:'2026-09'};
 const values=['=1+1',' +SUM(A1:A2)','\t@SUM(A1)','\r-2+3','\u0001 =2','normal, "quoted"\nsecond line'];
 const csv=f.env.__board.actionCsv(ctx,values.map((plan,i)=>({businessNo:'00'+i,businessName:'safe',statuses:{},plan,status:'IN_PROGRESS',partnerAction:{plan:'hidden',editedFields:[]}})));
 for(const payload of values.slice(0,-1))assert.ok(csv.includes('"\''+payload+'"'),'Dangerous spreadsheet prefix must be neutralized');
 assert.ok(csv.includes('"normal, ""quoted""\nsecond line"'),'CSV quotes and multiline text must survive');assert.ok(!csv.includes('hidden'),'Unedited partner values must stay absent');
 console.log('PASS OPERATIONAL CSV: controls/whitespace/formula prefixes, quoting, multiline text and separate master/partner fields');
}
{
 const f=fixture();f.change('month','2026-08');
 assert.equal(f.el('newSupply').textContent,'—');assert.match(f.el('changeBody').innerHTML,/비교 자료 없음/);assert.equal(f.el('changeCsv').disabled,true);
 f.env.DCMUnifiedAction.select('new',{scroll:false});assert.match(f.el('ctActionBody').innerHTML,/비교 자료 없음/);assert.equal(f.el('ctActionExport').disabled,true);
 const ctx=f.env.DCMUnifiedAction.build();assert.ok(f.env.DCMUnifiedAction.filter(ctx,'supply').length>0);assert.equal(f.env.DCMUnifiedAction.filter(ctx,'new').length,0);
 f.env.__control.render();assert.equal(f.el('ctX2O').textContent,'—');assert.equal(f.el('ctO2X').textContent,'—');assert.match(f.el('ctAi').innerHTML,/전월 비교 자료 없음/);
 f.change('month','2026-09');assert.equal(f.el('newSupply').textContent,'0');assert.equal(f.el('changeCsv').disabled,false,'A real zero change remains zero when a previous month exists');
 console.log('PASS OPERATIONAL comparison: first available month is unknown; a true zero change remains zero');
}
{
 const f=fixture();f.change('manager','담당B');f.change('outlet','C유통');f.env.__view.renderEntities();f.env.__view.renderOutlets();f.env.__control.render();
 assert.match(f.el('entityCards').innerHTML,/평가 데이터 없음/);assert.ok(!f.el('entityCards').innerHTML.includes('0.0%'));assert.match(f.el('outletBody').innerHTML,/미평가/);assert.equal(f.el('ctTargetNeed').textContent,'미평가');
 assert.equal(f.env.__view.rateStatus(null,null),'미평가');assert.equal(f.env.__view.rateStatus(0,null),'위험');
 f.change('outlet','B유통');f.env.__view.renderEntities();assert.match(f.el('entityCards').innerHTML,/0\.0%/,'Actual 0% must not turn into missing data');
 f.change('manager','전체');f.change('outlet','전체');assert.equal(f.el('needCount').textContent,'62처','Same business ID in two outlets counts as two relationships');
 console.log('PASS OPERATIONAL evaluation: missing values differ from 0%, and absolute retailer counts respect outlet identity');
}

{
 const f=fixture({manager:'전체',outlet:'전체',month:'2026-09'});
 const count=()=> (f.el('needBody').innerHTML.match(/<tr>/g)||[]).length;
 assert.equal(count(),60);assert.equal(f.el('needBodyMore').hidden,false);
 f.el('needBodyMore').onclick();assert.equal(count(),62);assert.equal(f.el('needBodyMore').hidden,true);
 f.env.__app.render();assert.equal(count(),60,'Filter renders restart pagination');
 f.change('month','2026-08');assert.equal(f.el('changeBodyMore').hidden,true,'No prior month cannot expose stale rows');
 console.log('PASS bounded read-only lists: all rows reachable, counts retained, pagination and empty period reset');
}
