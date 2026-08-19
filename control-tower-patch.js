(()=>{
'use strict';
const DATA_KEY='dcm-dashboard-v8-data',ACTION_KEY='dcm-dashboard-v10-actions';
window.addEventListener('load',()=>{
  const old=document.getElementById('resetBtn');
  if(!old)return;
  const b=old.cloneNode(true);
  old.replaceWith(b);
  b.onclick=()=>{
    if(!confirm('브라우저에 추가한 월별 데이터와 Action 이력을 지우고 최초 6월/7월 데이터로 복원할까요?'))return;
    localStorage.setItem(DATA_KEY,JSON.stringify(window.DCM_BASE_DATA||[]));
    localStorage.setItem(ACTION_KEY,'[]');
    location.reload();
  };
});
})();