import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(p,'utf8');
const legacySource=read('control-tower.js');
const patchSource=read('control-tower-patch.js');
const syncSource=read('action-sync.js');
const html=read('index.html');
const keyOf=r=>r.outlet+'|||'+r.businessNo;
const statuses=(a,b,c)=>({'대웅제약':a,'대웅바이오':b,'한올바이오':c});

assert.equal((html.match(/id="ctActionBody"/g)||[]).length,1,'Only one unified board can own the table');
assert.ok(!legacySource.includes("const ab=$('ctActionBody');if(ab)ab.innerHTML="),
 'Legacy 9-column render must not write into the unified tbody');
assert.ok(!/querySelectorAll\(['"]#ctActionBody tr['"]\)/.test(syncSource),
 'Action metadata must not depend on DOM column offsets');
assert.ok(html.includes('control-tower.js?v=20261021usability2'),
 'Cache-busted legacy renderer is required on deployed clients');


const optionsFor=id=>{
 const section=html.match(new RegExp('<select id="'+id+'"[^>]*>([\\s\\S]*?)<\\/select>'))?.[1];
 assert.ok(section,'Missing filter dropdown '+id);
 return [...section.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)]
  .map(([,value,label])=>({value,label}));
};
assert.deepEqual(optionsFor('ctActionView'),[
 {value:'supply',label:'전체 거래처'},{value:'x',label:'우선 조치 필요처'}]);
assert.deepEqual(optionsFor('ctActionDetail'),[
 {value:'all',label:'전체'},
 {value:'persist',label:'2개월 이상 지속 X'},
 {value:'all3',label:'3개사 모두 X'},
 {value:'improved',label:'X→O 개선 거래처'},
 {value:'worsened',label:'O→X 악화 거래처'},
 {value:'new',label:'신규 공급처'},
 {value:'stopped',label:'중단 공급처'}]);
assert.ok(!html.includes('id="ctActionEntity"'),'Removed redundant group-company filter returned');

const data=[],risks=[];
for(let i=1;i<=125;i++){
 const businessNo=String(i).padStart(4,'0'),businessName='검증 거래처 '+businessNo;
 const prior=i===9?statuses('O','X','X'):statuses('X','X','X');
 const current=i===5?statuses('O','X','X'):statuses('X','X','X');
 for(const [month,st] of [['2026-08',prior],['2026-09',current]])
   data.push({month,outlet:'검증 유통협력사',businessNo,businessName,manager:'검증 담당자',statuses:st});
 risks.push({key:'검증 유통협력사|||'+businessNo,outlet:'검증 유통협력사',businessNo,
  businessName,manager:'검증 담당자',score:i%3===0?14:5,
  priority:i%3===0?'P1':'P3',aging:'4M',xCount:i===5?2:3,
  partnerAction:{editedFields:['reasonCode'],reasonCode:'03',updatedAt:'2026-10-14'}});
}
const dom=new Map(),listeners=new Map(),domListeners=new Map();
const el=id=>{
 if(!dom.has(id))dom.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},hidden:false,
   querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}},setAttribute(){},
   closest:()=>null,scrollIntoView(){},addEventListener(type,fn){domListeners.set(id+':'+type,fn);}});
 return dom.get(id);
};
for(const [id,v] of [['manager','전체'],['outlet','전체'],['month','2026-09'],
 ['ctActionView','supply'],['ctActionDetail','all'],['ctActionSearch','']])el(id).value=v;
el('ctActionDetail').options=optionsFor('ctActionDetail').map(o=>({...o,textContent:o.label,remove(){}}));
el('ctAction');el('ctActionClear');
const localStorage={getItem(k){
 if(k==='dcm-dashboard-v8-data')return JSON.stringify(data);
 if(k==='dcm-dashboard-v10-actions')return '[]';
 return null;
}};
const sandbox={console,localStorage,DCM_BASE_DATA:data,DCM_ACTION_REASONS:{'03':'전산/데이터 오류'},
 DCM_CONFIG:{},DCMActionSync:{allRisk:()=>risks,canEditFor:manager=>manager==='검증 담당자'},
 document:{getElementById:id=>dom.has(id)||['ctActionBody','ctActionCount','ctActionShown','ctActionMore','ctActionAll','ctActionViewName'].includes(id)?el(id):null,
   querySelectorAll:()=>[]},
 addEventListener:(name,fn)=>{const a=listeners.get(name)||[];a.push(fn);listeners.set(name,a);},
 setTimeout:()=>0,clearTimeout(){}};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);vm.runInContext(read('logic.js'),sandbox);
const inject=(source,addon)=>{
 const pos=source.lastIndexOf('})();');
 assert.ok(pos>0,'Script must end in IIFE');
 return source.slice(0,pos)+addon+'\n'+source.slice(pos);
};
const patchHook='window.__boardRegression={'+
 'default(){actionLimit=PAGE_SIZE;actionView="x";renderAllXActionBoard();},'+
 'more(){actionLimit+=PAGE_SIZE;renderAllXActionBoard();},'+
 'all(){actionLimit=Number.MAX_SAFE_INTEGER;renderAllXActionBoard();},'+
 'view(v){actionView=v;actionLimit=PAGE_SIZE;renderAllXActionBoard();},'+
 'init(){installAllXBoard();},'+
 'state(){return {base:actionBase,detail:actionDetail,view:actionView}},'+
 'render(){renderAllXActionBoard();}'+
 '};';
vm.runInContext(inject(patchSource,patchHook),sandbox);
const board=el('ctActionBody');
const expectRows=(count,label)=>{
 const lines=board.innerHTML.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)||[];
 assert.equal(lines.length,count,label+' total row count');
 for(const [i,line] of lines.entries()){
   const td=(line.match(/<td\b[^>]*>/g)||[]).length;
   assert.equal(td,10,label+' row '+i+' has invalid '+td+'-column markup');
   assert.equal((line.match(/class="ct-ox-cell"/g)||[]).length,3,label+' company O/X positions');
   assert.equal((line.match(/class="ct-dual-cell"/g)||[]).length,3,label+' master/partner action columns');
 }
 assert.ok(board.innerHTML.includes('data-allx-field="reasonCode"'),label+' master reason field missing');
 assert.ok(board.innerHTML.includes('data-srm-open='),label+' SRM entry missing');
 assert.ok(!board.innerHTML.includes('data-field="reasonCode"'),label+' stale field reappeared');
 assert.ok(!board.innerHTML.includes('data-allx-field="dueDate"'),label+' due-date input must not appear');
 assert.ok(board.innerHTML.includes('data-label="조치계획"'),label+' mobile card labels missing');
 assert.ok(!board.innerHTML.includes('수정 PIN으로 공용 Sync에 접속'),label+' permission instructions must not repeat inside cells');
 assert.ok(!/ct-score|ct-priority/.test(board.innerHTML),label+' scoring UI must remain removed');
};
// The actual browser change handlers must keep the two filters mutually coherent.
sandbox.__boardRegression.init();
assert.ok(domListeners.has('ctActionView:change'),'Base filter listener missing: '+[...domListeners.keys()].join(','));
assert.ok(domListeners.has('ctActionDetail:change'),'Detail filter listener missing: '+[...domListeners.keys()].join(','));
assert.deepEqual({...sandbox.__boardRegression.state()},{base:'supply',detail:'all',view:'supply'});
el('ctActionView').value='x';
domListeners.get('ctActionView:change')();
assert.deepEqual({...sandbox.__boardRegression.state()},{base:'x',detail:'all',view:'x'});
el('ctActionDetail').value='improved';
domListeners.get('ctActionDetail:change')();
assert.deepEqual({...sandbox.__boardRegression.state()},{base:'supply',detail:'improved',view:'improved'});
assert.equal(el('ctActionView').value,'supply',
 'O-only improvements must not be accidentally filtered by current X status');
sandbox.__boardRegression.render();expectRows(1,'X-to-O detail includes O-only improvement');
el('ctActionView').value='x';
domListeners.get('ctActionView:change')();
assert.equal(el('ctActionDetail').value,'all',
 'A new base selection must clear an incompatible detail filter');
assert.deepEqual({...sandbox.__boardRegression.state()},{base:'x',detail:'all',view:'x'});
el('ctActionDetail').value='stopped';
domListeners.get('ctActionDetail:change')();
assert.deepEqual({...sandbox.__boardRegression.state()},{base:'supply',detail:'stopped',view:'stopped'});
assert.equal(el('ctActionView').value,'supply');
el('ctActionSearch').value='0009';
domListeners.get('ctActionSearch:input')();
assert.equal(sandbox.__boardRegression.state().detail,'stopped','Search must preserve selected detail');
domListeners.get('ctActionClear:click')();
assert.deepEqual({...sandbox.__boardRegression.state()},{base:'supply',detail:'all',view:'supply'});
assert.equal(el('ctActionSearch').value,'');
sandbox.__boardRegression.default();expectRows(50,'Default 50 results');
sandbox.__boardRegression.more();expectRows(100,'50 more results');
sandbox.__boardRegression.all();expectRows(125,'All results');
sandbox.__boardRegression.view('improved');expectRows(1,'Improved X-to-O results');
sandbox.__boardRegression.default();expectRows(50,'Return to default');

// The real legacy Control Tower shares the page, but only owns KPI/report updates.
vm.runInContext(inject(legacySource,'window.__legacyRenderForTest=render;'),sandbox);
sandbox.__legacyRenderForTest();expectRows(50,'After legacy KPI rendering');
for(const callback of listeners.get('dcm-action-sync-applied')||[])callback({});
expectRows(50,'After master Action sync');
for(const callback of listeners.get('dcm-action-reasons-updated')||[])callback({});
expectRows(50,'After reason code sync');
sandbox.__boardRegression.more();expectRows(100,'After sync then more');
sandbox.__boardRegression.all();expectRows(125,'After sync then all');

// Saving must never confuse a status chip with the aging cell or merchant name.
const start=syncSource.indexOf('function enrichActions(actions){');
const end=syncSource.indexOf('\nasync function post(payload){',start);
assert.ok(start>=0&&end>start,'Cannot extract live action enrichment function');
const enrichContext={
 getData:()=>data,currentMonth:()=> '2026-09',
 scoped:(d,m)=>d.filter(r=>r.month===m),rowKey:keyOf,
 allRiskRows:()=>risks,editor:()=> '검증 담당자'
};
vm.createContext(enrichContext);
vm.runInContext(syncSource.slice(start,end)+'\nthis.enrich=enrichActions;',enrichContext);
const [saved]=enrichContext.enrich([{key:'검증 유통협력사|||0001',
 businessName:'화면 열 어긋남',aging:'X',plan:'기존 조치계획',status:'IN_PROGRESS'}]);
assert.equal(saved.businessName,'검증 거래처 0001','Source record name must be preserved');
assert.equal(saved.aging,'4M','Risk aging must be from source records');
assert.equal(saved.plan,'기존 조치계획','Action changes must remain intact');
assert.equal(saved.modifiedBy,'검증 담당자');
console.log('PASS UNIFIED 10-COLUMN HARNESS: default 50, next 50, all 125, filter, legacy redraw, Action/reason sync, source-backed save metadata');

