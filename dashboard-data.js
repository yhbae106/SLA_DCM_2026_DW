(()=>{
'use strict';
const META_KEY='dcm-dashboard-source-v1',E=['대웅제약','대웅바이오','한올바이오'];
let checkedHere='';
function validate(rows,{allowEmpty=false}={}){
 if(!Array.isArray(rows)||(!allowEmpty&&!rows.length))throw Error('확인 가능한 월별 데이터가 없습니다.');
 const keys=new Set();
 for(const r of rows){
  if(!r||typeof r!=='object'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(r.month)||
   typeof r.outlet!=='string'||!r.outlet.trim()||typeof r.businessNo!=='string'||!r.businessNo.trim()||
   !r.statuses||typeof r.statuses!=='object'||Array.isArray(r.statuses)||
   E.some(e=>![undefined,null,'','O','X'].includes(r.statuses[e])))throw Error('월·업체·사업자번호 또는 O/X 데이터 형식을 확인해 주세요.');
  const key=JSON.stringify([r.month,r.outlet,r.businessNo]);
  if(keys.has(key))throw Error('같은 월·업체·사업자번호가 중복되어 반영하지 않았습니다.');
  keys.add(key);
 }
 return rows;
}
function signature(rows){const s=JSON.stringify(rows);let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return rows.length+':'+(h>>>0);}
function mark(rows,source,meta={}){
 const sig=signature(rows);if(source==='shared')checkedHere=sig;
 try{localStorage.setItem(META_KEY,JSON.stringify({source,signature:sig,updatedAt:meta.updatedAt||'',checkedAt:source==='shared'?new Date().toISOString():'',recordedAt:new Date().toISOString()}));}catch(_){}
 window.dispatchEvent(new CustomEvent('dcm-dashboard-source-changed'));
}
function describe(rows){
 let m,stored=false;try{stored=!!localStorage.getItem('dcm-dashboard-v8-data');m=JSON.parse(localStorage.getItem(META_KEY));}catch(_){}
 const sig=signature(rows),matches=m?.signature===sig;
 let label=matches?({shared:checkedHere===sig?'공용 반영 확인':'브라우저에 보관한 공용 자료',excel:'Excel 반영본 · 공용 저장 확인 전',backup:'백업 미리보기 · 공용 저장 확인 전',reset:'초기 자료 · 공용 저장 확인 전'}[m.source]||'브라우저 보관 자료'):
  stored?'브라우저 보관 자료 · 공용 최신 여부 미확인':'배포 기본 자료 · 공용 최신 여부 미확인';
 if(matches&&m.source==='shared'){
  if(m.updatedAt&&!Number.isNaN(Date.parse(m.updatedAt)))label+=' · 공용 저장 '+new Date(m.updatedAt).toLocaleString('ko-KR');
  if(m.checkedAt)label+=' · 조회 확인 '+new Date(m.checkedAt).toLocaleString('ko-KR');
 }
 return label;
}
window.DCMDashboardData={validate,mark,describe};
})();
