import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.cwd(),fail=m=>{throw new Error(m)},ok=m=>console.log('PASS',m);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
const html=read('index.html');

const refs=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1].split(/[?#]/)[0]).filter(x=>x&&!/^(?:https?:|data:|#)/.test(x));
for(const r of refs)if(!exists(r))fail('Missing local asset: '+r);
ok('all index assets exist');

if(html.includes('cdn.sheetjs.com'))fail('SheetJS must not be eagerly loaded');
ok('SheetJS is lazy-loaded');

const required=['manager','outlet','month','fileInput','kpiRate','ctRate','ctActionBody','ctActionView','ctActionDetail','ctActionSearch','ctActionCount','needBody','changeBody'];
for(const id of required)if(!html.includes('id="'+id+'"'))fail('Missing required DOM id: '+id);
if(html.includes('id="ctActionEntity"'))fail('Redundant Action Board group-company filter returned');
ok('required dashboard DOM contract');
const unifiedHeader=html.match(/<div class="table-scroll ct-board"[^>]*><table><thead><tr>(.*?)<\/tr>/)?.[1]||'';
if((unifiedHeader.match(/<th/g)||[]).length!==10||unifiedHeader.includes('완료 예정일'))fail('Master Action Board must have 10 visible columns without due date');
const actionLayout=read('control-tower-layout.css');
if(!actionLayout.includes('table-layout:fixed')||!actionLayout.includes('overflow-x:hidden')||!actionLayout.includes('@media(max-width:1180px)'))fail('Master Action Board must fit width and provide responsive cards');
ok('10-column Master Action Board with no due date or horizontal scroll');
if(!html.includes('DCM 미연동 세부 현황')||!html.includes('7개월 이상'))fail('Korean period labels or 7-plus bucket missing');
if(html.includes('Risk Score 및 Priority 산정 기준')||html.includes('<th>Risk Score</th>')||html.includes('<th>Priority</th>'))fail('Misleading scoring display remains');
const agingCss=read('control-tower.css');
if(agingCss.includes('#ctAging .ct-card{height:100%}')||agingCss.includes('#ctAging .ct-target{height:100%'))fail('Target card overflow regression');
ok('Korean DCM period labels, contained 95 percent cards, and no score UI');

if(exists('SLA_DCM_2026_Partner'))fail('Legacy embedded Partner copy must stay removed');
ok('legacy embedded Partner copy removed');

function walk(dir='.'){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(e.name==='.git'||e.name==='node_modules')return[];return e.isDirectory()?walk(p):[p]})}
for(const file of walk().filter(x=>x.endsWith('.js'))){new vm.Script(read(file),{filename:file});}
ok('all JavaScript parses');
await import('./monthly-history-regression.mjs');
await import('./srm-metrics-regression.mjs');
await import('./srm-ui-regression.mjs');
await import('./srm-list-regression.mjs');
await import('./calendar-streak-regression.mjs');
await import('./operational-usability-regression.mjs');
await import('./srm-action-parity-regression.mjs');
await import('./sync-login-regression.mjs');
await import('./data-lifecycle-regression.mjs');
await import('./action-lifecycle-regression.mjs');

const ctx={};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(read('logic.js'),ctx);
const L=ctx.DCMLogic;if(!L)fail('DCMLogic not exported');
const S=(a,b,c)=>({'대웅제약':a,'대웅바이오':b,'한올바이오':c});
const prev=[
 {month:'2026-08',outlet:'A',manager:'M',businessNo:'1',businessName:'Alpha',statuses:S('X','O',null)},
 {month:'2026-08',outlet:'A',manager:'M',businessNo:'2',businessName:'Beta',statuses:S('O',null,null)}
];
const curr=[
 {month:'2026-09',outlet:'A',manager:'M',businessNo:'1',businessName:'Alpha',statuses:S('O','X',null)},
 {month:'2026-09',outlet:'A',manager:'M',businessNo:'3',businessName:'Gamma',statuses:S('O',null,null)}
];
const sum=L.summarize(curr);
if(sum.O!==2||sum.X!==1||sum.evaluated!==3||sum.needAbsolute!==1||sum.suppliedAbsolute!==2)fail('summarize regression');
const ch=L.compare(prev,curr);
if(ch.xToO.length!==1||ch.oToX.length!==1||ch.newSupply.length!==1||ch.stoppedSupply.length!==1)fail('compare regression');
if(L.needList(curr).length!==1)fail('needList regression');
ok('core DCM calculations');

const localAssets=[...new Set(refs)].filter(exists);
const initialBytes=fs.statSync('index.html').size+localAssets.reduce((s,p)=>s+fs.statSync(p).size,0);
// Reliability baseline: 586098 bytes. Operational scope, safe CSV and SRM navigation remain dependency-free within 600KB.
if(initialBytes>600000)fail('Initial local payload budget exceeded: '+initialBytes);
ok('initial local payload '+Math.round(initialBytes/1024)+' KB');

const expectedKpiOrder=['ctRate','ctDelta','ctX','ctNeedAbs','ctPersist','ctAll3','ctX2O','ctO2X','ctSupply'];
let lastKpiIndex=-1;
for(const id of expectedKpiOrder){
  const pos=html.indexOf('id="'+id+'"');
  if(pos<0||pos<=lastKpiIndex)fail('KPI missing or out of order: '+id);
  lastKpiIndex=pos;
}
ok('nine executive KPI cards in requested priority order');

if(html.includes('id="ctRiskBody"')||html.includes('<h2>Risk Priority TOP 20</h2>')||html.includes('<h2>담당자 Action Board</h2>'))
  fail('Duplicate TOP20/legacy Action Board has not been consolidated');
if((html.match(/id="ctActionBody"/g)||[]).length!==1)fail('More than one Action Board table detected');
for(const company of ['대웅제약','대웅바이오','한올바이오']){
 if(!html.includes('<th>'+company+'</th>'))fail('Missing company O/X column: '+company);
}
const masterPatch=read('control-tower-patch.js'),boardCss=read('control-tower-layout.css');
new Function(masterPatch);
if(!masterPatch.includes("const srm=$('srmWorkflow');if(srm&&action)action.insertAdjacentElement('afterend',srm);"))fail('SRM workflow must move alongside unified board');
if(!masterPatch.includes("data-srm-open")||!masterPatch.includes("readonlyPartnerMarkup")||!masterPatch.includes("saveBoardField"))
  fail('Unified Board lost SRM case link, partner notes or master write-back');
if(!masterPatch.includes("card.addEventListener('keydown'")||!masterPatch.includes('KPI_VIEWS'))
  fail('KPI cards are not interactive/keyboard accessible');
if(!boardCss.includes('.ct-action-filterbar')||!boardCss.includes('.ct-status-badge'))
  fail('Unified Action Board responsive controls/OX styles missing');
ok('one unified Action Board with three-company statuses and preserved edit controls');
await import('./unified-action-render-regression.mjs');

const mockData=[
 {month:'2026-06',outlet:'A',businessNo:'s',businessName:'Stop June X',manager:'M',statuses:S('X',null,null)},
 {month:'2026-07',outlet:'A',businessNo:'z',businessName:'July supplier',manager:'M',statuses:S('O',null,null)},
 {month:'2026-08',outlet:'A',businessNo:'1',businessName:'Alpha',manager:'M',statuses:S('X','O',null)},
 {month:'2026-08',outlet:'A',businessNo:'2',businessName:'Beta',manager:'M',statuses:S('X','X','X')},
 {month:'2026-08',outlet:'A',businessNo:'3',businessName:'Gamma',manager:'M',statuses:S('X',null,null)},
 {month:'2026-08',outlet:'A',businessNo:'4',businessName:'Delta',manager:'M',statuses:S('O','O','O')},
 {month:'2026-09',outlet:'A',businessNo:'1',businessName:'Alpha',manager:'M',statuses:S('O','X',null)},
 {month:'2026-09',outlet:'A',businessNo:'2',businessName:'Beta',manager:'M',statuses:S('X','X','X')},
 {month:'2026-09',outlet:'A',businessNo:'3',businessName:'Gamma',manager:'M',statuses:S('O',null,null)},
 {month:'2026-09',outlet:'A',businessNo:'4',businessName:'Delta',manager:'M',statuses:S('O','O','O')}
];
const uiEnv={DCMLogic:L,DCM_BASE_DATA:mockData,
 localStorage:{getItem:key=>key==='dcm-dashboard-v8-data'?JSON.stringify(mockData):'[]'},
 document:{getElementById:id=>({manager:'전체',outlet:'전체',month:'2026-09'})[id]?{value:({manager:'전체',outlet:'전체',month:'2026-09'})[id]}:null},
 addEventListener(){},DCMActionSync:{canEditFor:manager=>manager==='M',allRisk:()=>[
  {key:'A|||1',outlet:'A',businessNo:'1',score:8,xCount:1,priority:'P2'},
  {key:'A|||2',outlet:'A',businessNo:'2',score:15,xCount:3,priority:'P1'}
 ]}};
uiEnv.window=uiEnv;uiEnv.globalThis=uiEnv;
vm.createContext(uiEnv);
vm.runInContext(read('data/monthly-action-history.js'),uiEnv);
vm.runInContext(masterPatch,uiEnv);
const board=uiEnv.DCMUnifiedAction;
if(!board)fail('Master unified list selection module missing');
const context=board.build();
if(board.label('new','2026-07')!=='7월 신규 공급처'||board.label('stopped','2026-08')!=='8월 중단 공급처'||board.label('new','2026-09')!=='9월 신규 공급처')fail('Month-specific Action Board option labels failed');
const archived=uiEnv.DCM_MONTHLY_ACTION_HISTORY.get('2026-09','A|||3');
if(!archived||archived.masterAction.status!=='DONE'||archived.partnerAction.status!=='DONE')
  fail('Master July/Aug/Sept historical X→O completion projection failed');
const monthlyRow=context.rows.find(r=>r.key==='A|||3');
if(!monthlyRow?.monthlyHistorical||monthlyRow.canEdit!==false||
 monthlyRow.masterAction.plan!=='ERP업체 소통하여 정상 연동 조치'||
 monthlyRow.partnerAction.plan!=='거래처 요청 및 대웅 협조')
  fail('Master historical view did not preserve separate read-only plans');
if(board.filter(context,'history').map(r=>r.businessNo).join(',')!=='3')fail('Master monthly history filter must show O-only converted transaction');
ok('Master month-specific completed action appears read-only in unified board');

const ids=(view,entity='all',priority='all',q='')=>board.filter(context,view,entity,priority,q).map(x=>x.businessNo).sort().join(',');
if(ids('x')!=='1,2')fail('X filter excludes/include wrong records');
if(ids('persist')!=='2'||ids('all3')!=='2')fail('Persistent/3-company X result invalid');
if(ids('improved')!=='1,3')fail('X→O must include O-only improvement');
if(ids('worsened')!=='1')fail('O→X filter mismatch');
if(ids('supply')!=='1,2,3,4')fail('All supplied merchants must include O-only records');
if(ids('new')!==''||ids('stopped')!=='')fail('No new/stopped supply in same-merchant fixture');
if(ids('x','대웅제약')!=='2'||ids('x','대웅바이오')!=='1,2')fail('Company selection failed');
if(ids('x','all','P1')!=='2')fail('Risk Priority filter failed');
if(ids('supply','all','all','Gamma')!=='3'||ids('x','all','all','impossible')!=='')fail('Search filter failed');
if(context.rows.length!==4)fail('Unique retailer deduplication lost');
ok('unified Board KPI, persistent X, all3, X-to-O, O-to-X, company, priority and search filters');
const oldFind=uiEnv.document.getElementById;
uiEnv.document.getElementById=id=>{
  if(id==='month')return {value:'2026-07'};
  return oldFind(id);
};
const julyStop=board.build();
if(!julyStop.rows.some(r=>r.key==='A|||s'))fail('Master July must project missing-sales June-X merchant into history');
const only=board.filter(julyStop,'stopped');
if(only.length!==1||only[0].key!=='A|||s')fail('Master stopped filter missing July no-sales merchant');
if(only[0].partnerAction.reasonCode!=='04'||
 only[0].partnerAction.plan!=='공급 중단'||
 only[0].partnerAction.dueDate!=='2026-07-31'||
 only[0].partnerAction.status!=='DONE')
  fail('Master did not surface independent Partner stop closure');
if(only[0].masterAction.plan||only[0].masterAction.reasonCode||only[0].canEdit!==false)
  fail('Partner-only July closure must not manufacture Master actions');
uiEnv.document.getElementById=oldFind;
ok('Master July missing-sales synthetic Partner 04 DONE record and unchanged master fields');


vm.runInContext(read('data/base-data.js'),ctx);
const daejeon=ctx.DCM_BASE_DATA.filter(r=>r.outlet==='백제약품 대전');
if(!daejeon.length||daejeon.some(r=>r.manager!=='정직한'))fail('Historical Daejeon manager not corrected');
if(ctx.DCM_CONFIG.managerByOutlet['백제약품 대전']!=='정직한')fail('Daejeon default mapping incorrect');
ok('all '+daejeon.length+' historical Daejeon records and mapping owned by Jeong');
const gas=read('apps-script/Code.gs');
new Function(gas);
if(!gas.includes('partnerSaveAction')||!gas.includes('savePartnerAction_'))fail('Authenticated Partner write-back endpoint missing');
if(!gas.includes('repairActionReasonValidation'))fail('Repair utility for legacy H validation missing');
for(const contract of ['function assertUniqueActionKeys_','function uniqueSnapshotActions_','duplicateKeys:[...duplicateKeys]']){
 if(!gas.includes(contract))fail('Action Board key uniqueness guard missing: '+contract);
}

if(!gas.includes("body.type === 'partnerActions'")||!gas.includes("assertPartnerPassword_(partner, body.password)"))fail('Authenticated Partner Action read endpoint missing');
if(!gas.includes("type === 'dashboard') throw"))fail('Public Dashboard GET unexpectedly enabled');
if(!gas.includes('fixDaejeonManagersInSheets'))fail('Owner-run historical repair utility missing');
ok('Apps Script dual-source auth, H validation repair and historical manager repair');
await import('./gas-regression.mjs');

const workflow=read('srm-workflow.js');
new Function(workflow);
if(!workflow.includes('grid-template-columns:repeat(auto-fit,minmax(min(100%,245px),1fr))'))
  fail('SRM form must use responsive container-width grid, not three fixed columns');
if(!workflow.includes('box-sizing:border-box')||!workflow.includes('overflow-x:hidden'))
  fail('SRM fields/table do not isolate horizontal overflow');
if(!workflow.includes("const host=target?.parentNode||document.querySelector('main.wrap')||document.body"))
  fail('SRM panel can escape the dashboard main container');
if(!workflow.includes("const target=isPartner()?$('action'):$('ctActionBody')?.closest('section')"))
  fail('Master SRM panel anchor is not the Action Board section');
if(!workflow.includes('srmNeedsAction')||!workflow.includes('srmConsulted')||
   workflow.includes('srmOverdue')||workflow.includes('srm-dueDate')||
   workflow.includes('>기한</th>')||workflow.includes('기한 초과'))
   fail('SRM must show six grounded metrics without obsolete deadline inputs or KPIs');
if(!workflow.includes('table-layout:fixed')||!workflow.includes('min-width:0')||
   !workflow.includes('data-label="다음 조치"'))
   fail('SRM five-column table must not require horizontal scrolling on desktop or mobile');
ok('SRM six grounded KPI cards, deadline-free editor/table and responsive in-layout mount');

if(!html.includes('srm-workflow.js')||!workflow.includes('SRM')||!workflow.includes('srmAppend'))fail('SRM execution panel missing');
if(!gas.includes("type === 'srmAppend'")||!gas.includes('srmCheckTransition_'))fail('SRM backend and verified X-to-O route missing');
if(!read('control-tower-patch.js').includes('data-srm-open'))fail('Master Action Board must open SRM case');
ok('SRM Master workflow panel and event contracts');
const liveSync=read('action-sync.js');
if(!liveSync.includes("post({type:'load'})"))fail('Action read must use authenticated POST load');
if(liveSync.includes("url.searchParams.set('token'"))fail('Secret must not be sent in GET URL');
if(!liveSync.includes('syncBroken=true'))fail('HTTP404 retry circuit breaker missing');
if(!liveSync.includes("REQUIRED_API_VERSION='20261008-seven-reasons-fast-v3'"))fail('Exact GAS deployment version gate missing');
if(liveSync.includes("post({type:'repairReasonValidation'})")||liveSync.includes('ctReasonRepair'))fail('Obsolete H-column repair action must not appear in Dashboard UI');
if(!liveSync.includes('signInFromButton')||!liveSync.includes('SESSION_TOKEN_KEY'))fail('Explicit login flow and tab-scoped auth missing');
if(!liveSync.includes('ctSyncPinApply')||!liveSync.includes('ctSyncRefresh'))fail('Separate editing PIN and authenticated refresh actions missing');
if(liveSync.includes('localStorage.setItem(TOKEN_KEY'))fail('Shared secret must not be stored permanently in localStorage');
const reasonConfig=read('action-sync-config.js');
if(!reasonConfig.includes("'05':'도매몰 미연동'")||reasonConfig.includes("'08':'도매몰 연동 필요'"))
  fail('Dashboard reason dictionary is not the approved seven-code scale');
if(!gas.includes("const DCM_SYNC_API_VERSION = '20261008-seven-reasons-fast-v3'"))
  fail('Backend deployment version not updated');

if(!liveSync.includes("PENDING_KEY='dcm-action-master-pending-v1'"))fail('Unsent master edits are not persisted');
if(!liveSync.includes('if(pending){')||!liveSync.includes('미전송 수정'))fail('Unsent edits must survive successful read-only login');

const liveAPI=read('apps-script/Code.gs');
if(!liveAPI.includes("body.type === 'partnerLogin'")||!liveAPI.includes("body.type === 'partnerSaveActions'"))fail('Fast login or batch saving endpoint missing');
if(!liveAPI.includes("type === 'health'"))fail('Public endpoint health probe missing');
if(!liveAPI.includes("loadPartnerDashboardData_(partner)"))fail('Partner dataset fetch route missing');
ok('POST Action sync, 404 recovery and fast/batch API contracts');
console.log('HARNESS_OK');

await import('./polling-regression.mjs');
