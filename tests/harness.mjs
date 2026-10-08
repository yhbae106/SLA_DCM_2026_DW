import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const root=process.cwd(),fail=m=>{throw new Error(m)},ok=m=>console.log('PASS',m);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
const html=read('index.html');

const refs=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1].split(/[?#]/)[0]).filter(x=>x&&!/^(?:https?:|data:|#)/.test(x));
for(const r of refs)if(!exists(r))fail('Missing local asset: '+r);
ok('all index assets exist');

if(html.includes('cdn.sheetjs.com'))fail('SheetJS must not be eagerly loaded');
ok('SheetJS is lazy-loaded');

const required=['manager','outlet','month','fileInput','kpiRate','ctRate','ctRiskBody','ctActionBody','needBody','changeBody'];
for(const id of required)if(!html.includes('id="'+id+'"'))fail('Missing required DOM id: '+id);
ok('required dashboard DOM contract');

if(exists('SLA_DCM_2026_Partner'))fail('Legacy embedded Partner copy must stay removed');
ok('legacy embedded Partner copy removed');

function walk(dir='.'){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(e.name==='.git'||e.name==='node_modules')return[];return e.isDirectory()?walk(p):[p]})}
for(const file of walk().filter(x=>x.endsWith('.js'))){execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}
ok('all JavaScript parses');

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
if(initialBytes>560000)fail('Initial local payload budget exceeded: '+initialBytes);
ok('initial local payload '+Math.round(initialBytes/1024)+' KB');

const expectedKpiOrder=['ctRate','ctDelta','ctX','ctNeedAbs','ctPersist','ctAll3','ctX2O','ctO2X','ctSupply'];
let lastKpiIndex=-1;
for(const id of expectedKpiOrder){
  const pos=html.indexOf('id="'+id+'"');
  if(pos<0||pos<=lastKpiIndex)fail('KPI missing or out of order: '+id);
  lastKpiIndex=pos;
}
ok('nine executive KPI cards in requested priority order');
vm.runInContext(read('data/base-data.js'),ctx);
const daejeon=ctx.DCM_BASE_DATA.filter(r=>r.outlet==='백제약품 대전');
if(!daejeon.length||daejeon.some(r=>r.manager!=='정직한'))fail('Historical Daejeon manager not corrected');
if(ctx.DCM_CONFIG.managerByOutlet['백제약품 대전']!=='정직한')fail('Daejeon default mapping incorrect');
ok('all '+daejeon.length+' historical Daejeon records and mapping owned by Jeong');
const gas=read('apps-script/Code.gs');
new Function(gas);
if(!gas.includes('partnerSaveAction')||!gas.includes('savePartnerAction_'))fail('Authenticated Partner write-back endpoint missing');
if(!gas.includes('repairActionReasonValidation'))fail('Repair utility for legacy H validation missing');
if(!gas.includes("body.type === 'partnerActions'")||!gas.includes("assertPartnerPassword_(partner, body.password)"))fail('Authenticated Partner Action read endpoint missing');
if(!gas.includes("type === 'dashboard') throw"))fail('Public Dashboard GET unexpectedly enabled');
if(!gas.includes('fixDaejeonManagersInSheets'))fail('Owner-run historical repair utility missing');
ok('Apps Script dual-source auth, H validation repair and historical manager repair');
await import('./gas-regression.mjs');

const liveSync=read('action-sync.js');
if(!liveSync.includes("post({type:'load'})"))fail('Action read must use authenticated POST load');
if(liveSync.includes("url.searchParams.set('token'"))fail('Secret must not be sent in GET URL');
if(!liveSync.includes('syncBroken=true'))fail('HTTP404 retry circuit breaker missing');
if(!liveSync.includes("REQUIRED_API_VERSION='20261008-seven-reasons-fast-v3'"))fail('Exact GAS deployment version gate missing');
if(!liveSync.includes("post({type:'repairReasonValidation'})"))fail('One-click H31/H110 repair call missing');
if(liveSync.includes("sessionStorage.getItem(REPAIR_SESSION_KEY)!=='1'"))fail('Full H validation rebuild still runs during normal Sync');
const reasonConfig=read('action-sync-config.js');
if(!reasonConfig.includes("'05':'도매몰 미연동'")||reasonConfig.includes("'08':'도매몰 연동 필요'"))
  fail('Dashboard reason dictionary is not the approved seven-code scale');
if(!gas.includes("const DCM_SYNC_API_VERSION = '20261008-seven-reasons-fast-v3'"))
  fail('Backend deployment version not updated');

if(!liveSync.includes("PENDING_KEY='dcm-action-master-pending-v1'"))fail('Unsent master edits are not persisted');
if(!liveSync.includes('if(!saved)return false'))fail('Failed pending writes may be overwritten by remote sync');
if(!liveSync.includes('ctReasonRepair'))fail('Master sheet repair button missing');

const liveAPI=read('apps-script/Code.gs');
if(!liveAPI.includes("body.type === 'partnerLogin'")||!liveAPI.includes("body.type === 'partnerSaveActions'"))fail('Fast login or batch saving endpoint missing');
if(!liveAPI.includes("type === 'health'"))fail('Public endpoint health probe missing');
if(!liveAPI.includes("loadPartnerDashboardData_(partner)"))fail('Partner dataset fetch route missing');
ok('POST Action sync, 404 recovery and fast/batch API contracts');
console.log('HARNESS_OK');