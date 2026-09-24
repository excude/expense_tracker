"use strict";
const $=id=>document.getElementById(id), cfg=window.APP_CONFIG;
const state={data:{records:[],cards:[]},page:0,busy:false,initialized:false,settingsReady:false,excluded:[],nicknames:{},role:null};
const won=v=>Number(v).toLocaleString('ko-KR')+'원';
let auth, db, stop, accessStop, settingsStop, generation=0;
function notify(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').className=error?'error':'success';}
function options(el,items,all){const signature=JSON.stringify([all,items]);if(el.dataset.optionsSignature===signature)return;el.dataset.optionsSignature=signature;const selected=el.value;el.replaceChildren(new Option(all,''),...items.map(x=>new Option(x.label,x.value)));el.value=items.some(x=>String(x.value)===selected)?selected:'';}
function show(data){state.data=data;const selected=$('month').value;const months=[...new Set(data.records.map(r=>r.date.slice(0,7)))].sort().reverse();$('month').replaceChildren(...months.map(m=>new Option(m,m)));$('month').value=months.includes(selected)?selected:(data.latestMonth||months[0]||'');state.initialized=true;render();}
async function run(fn){if(state.busy)return;state.busy=true;notify('');try{await fn();}catch(e){notify(e.code?.startsWith('auth/')?'로그인 정보를 확인해 주세요.':e.message,true);}finally{state.busy=false;render();}}
function parse(bytes){return new Promise((resolve,reject)=>{const worker=new Worker('./parse-worker.js?v=0.08');const timer=setTimeout(()=>{worker.terminate();reject(Error('백업 분석 시간이 초과되었습니다.'));},60000);worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data);};worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('백업 분석에 실패했습니다.'));};worker.postMessage(bytes,[bytes]);});}
async function loadSnapshot(meta,epoch){
 if(!meta){show({records:[],cards:[]});return;}
 const ref=db.doc('users/'+cfg.ledgerId+'/snapshots/'+meta.snapshotId);
 const snap=await ref.collection('chunks').orderBy('index').get();
 if(snap.size!==meta.chunkCount)throw Error('백업이 완전하지 않습니다. 다시 동기화해 주세요.');
 const encoded=snap.docs.map(d=>d.data().payload).join('');
 const raw=atob(encoded), bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const data=await parse(bytes.buffer);
 if(epoch!==generation||!auth.currentUser)return;
 show(data);$('last-update').textContent='마지막 반영 '+new Date(meta.updatedAt).toLocaleString('ko-KR');
 $('drive-status').textContent=meta.source==='drive'?'드라이브 자동 반영':'직접 업로드';
}
async function upload(file){
 if(file.size>6*1024*1024)throw Error('무료 구성에서는 6MiB 이하의 백업을 지원합니다.');
 const bytes=await file.arrayBuffer();await parse(bytes.slice(0));
 let raw='';const arr=new Uint8Array(bytes);for(let i=0;i<arr.length;i+=8192)raw+=String.fromCharCode(...arr.subarray(i,i+8192));
 const encoded=btoa(raw), snapshotId=crypto.randomUUID(), chunkCount=Math.ceil(encoded.length/350000), updatedAt=new Date().toISOString();
 const base=db.doc('users/'+cfg.ledgerId+'/snapshots/'+snapshotId), batch=db.batch();
 for(let i=0;i<chunkCount;i++)batch.set(base.collection('chunks').doc(String(i).padStart(3,'0')),{index:i,payload:encoded.slice(i*350000,(i+1)*350000)});
 batch.set(base,{chunkCount,updatedAt});batch.set(db.doc('users/'+cfg.ledgerId+'/meta/current'),{snapshotId,chunkCount,updatedAt,source:'manual'});
 await batch.commit();notify('백업을 저장했습니다. 내역을 불러옵니다.');try{await cleanup();}catch{notify('백업은 저장됐지만 이전 사본 정리에 실패했습니다. 접근 규칙과 할당량을 확인해 주세요.',true);}
}
async function cleanup(){
 const cutoff=new Date(Date.now()-86400000).toISOString();
 const old=await db.collection('users/'+cfg.ledgerId+'/snapshots').where('updatedAt','<',cutoff).limit(30).get();
 const current=(await db.doc('users/'+cfg.ledgerId+'/meta/current').get()).data();
 for(const doc of old.docs){if(doc.id===current?.snapshotId)continue;const chunks=await doc.ref.collection('chunks').get();const batch=db.batch();chunks.docs.forEach(d=>batch.delete(d.ref));batch.delete(doc.ref);await batch.commit();}
}
function text(tag,value,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;}
function cardExcluded(card){return (card.sourceIds||[String(card.id)]).some(id=>state.excluded.includes(String(id)));}
function includedRecords(){const excluded=new Set((state.data.cards||[]).filter(cardExcluded).map(c=>String(c.id)));return state.settingsReady?state.data.records.filter(r=>!excluded.has(String(r.cardId))):[];}
function nickname(card){for(const id of [String(card.id),...(card.sourceIds||[])]){const name=state.nicknames[String(id)];if(typeof name==='string'&&name.trim())return name.trim();}return '';}
function cardLabel(card){return nickname(card)||card.name;}
function recordLabel(record){const card=state.data.cards.find(c=>String(c.id)===String(record.cardId));return card?cardLabel(card):record.card;}
function monthlyCards(){const month=$('month').value,totals=new Map();if(month)for(const r of state.data.records){if(!r.date.startsWith(month))continue;const id=String(r.cardId),value=totals.get(id)||{amount:0,count:0};value.amount+=r.amount;value.count++;totals.set(id,value);}return state.data.cards.map(card=>({card,...(totals.get(String(card.id))||{amount:0,count:0})})).sort((a,b)=>b.amount-a.amount||cardLabel(a.card).localeCompare(cardLabel(b.card),'ko')||String(a.card.id).localeCompare(String(b.card.id)));}
function updateCardOptions(){const cards=state.settingsReady?monthlyCards().filter(x=>x.count&&!cardExcluded(x.card)):[];options($('card'),cards.map(x=>({value:String(x.card.id),label:cardLabel(x.card)+' · '+won(x.amount)})),'전체 카드 · '+won(cards.reduce((sum,x)=>sum+x.amount,0)));}
function drawAdmin(){const root=$('admin-cards');root.replaceChildren(text('p',($('month').value||'조회 월 없음')+' 순사용액 높은 순 · 제외 카드도 표시'));for(const {card:c,amount} of monthlyCards()){const row=text('div','','admin-card');row.dataset.cardId=String(c.id);const label=text('label','');const check=document.createElement('input');check.type='checkbox';check.checked=!cardExcluded(c);label.append(check,document.createTextNode(c.name+' · '+won(amount)));const input=document.createElement('input');input.type='text';input.maxLength=60;input.value=nickname(c);input.placeholder='닉네임 (비우면 원래 이름)';input.setAttribute('aria-label',c.name+' 닉네임');row.append(label,input);root.append(row);}}
$('admin-button').onclick=()=>{if(state.role!=='editor'||!state.settingsReady)return;drawAdmin();$('card-admin').showModal();};
$('admin-close').onclick=()=>$('card-admin').close();
$('admin-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(state.role!=='editor'||!state.settingsReady)throw Error('관리자 권한이 필요합니다.');const excluded=new Set(state.excluded),nicknames={...state.nicknames};for(const row of $('admin-cards').querySelectorAll('.admin-card')){const card=state.data.cards.find(c=>String(c.id)===row.dataset.cardId);for(const id of card.sourceIds||[String(card.id)]){if(row.querySelector('input[type=checkbox]').checked)excluded.delete(String(id));else excluded.add(String(id));const value=row.querySelector('input[type=text]').value.trim();if(value)nicknames[String(id)]=value;else delete nicknames[String(id)];}}await db.doc('users/'+cfg.ledgerId+'/meta/cardSettings').set({excludedCardIds:[...excluded],nicknames,updatedAt:new Date().toISOString()});$('card-admin').close();notify('모든 사용자에게 카드 설정을 저장했습니다.');});};
function render(){if($('monthly-stats').open)drawMonthlyStats();updateCardOptions();syncPickerLabels();const records=includedRecords().filter(r=>($('month').value&&r.date.startsWith($('month').value))&&(!$('card').value||String(r.cardId)===$('card').value)&&(!$('search').value||(r.store+' '+r.card+' '+recordLabel(r)).toLowerCase().includes($('search').value.toLowerCase())));const cancelled=records.filter(r=>r.status==='취소');const approved=records.filter(r=>r.status!=='취소');$('total').textContent=won(records.reduce((s,r)=>s+r.amount,0));$('approved').textContent=won(approved.reduce((s,r)=>s+r.amount,0));$('cancelled').textContent=won(cancelled.reduce((s,r)=>s+r.amount,0));$('approved-count').textContent=approved.length.toLocaleString()+'건';$('cancelled-count').textContent=cancelled.length.toLocaleString()+'건';$('count').textContent=records.length.toLocaleString()+'건';const max=Math.max(1,Math.ceil(records.length/50));state.page=Math.min(state.page,max-1);$('page').textContent=(state.page+1)+' / '+max;$('prev').disabled=state.busy||!state.page;$('next').disabled=state.busy||state.page+1>=max;const rows=$('rows');rows.replaceChildren();for(const r of records.slice(state.page*50,state.page*50+50)){const row=text('article','','transaction');const left=text('div','','transaction-info');left.append(text('b',r.store||'가맹점 정보 없음'),text('span',recordLabel(r)+' · '+r.date+' '+r.time.slice(0,5)));const right=text('div','','amount');right.append(text('b',won(r.amount),r.status==='취소'?'cancel':''),text('span',r.status+(r.installments?' · '+r.installments+'개월 할부':'')));row.append(left,right);rows.append(row)}if(!records.length){const empty=text('div','','empty');empty.append(text('h3',state.data.records.length?'해당하는 거래가 없어요':'백업 파일을 올려 주세요'),text('p',state.data.records.length?'조회 조건을 바꿔 보세요.':'체리피커에서 내보낸 .db 파일을 선택하세요.'));rows.append(empty)}}

function monthlyTotals(records){const totals=new Map();for(const r of records){const month=r.date.slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))continue;totals.set(month,(totals.get(month)||0)+r.amount);}if(!totals.size)return [];const keys=[...totals.keys()].sort();let [year,month]=keys[0].split('-').map(Number);const last=keys[keys.length-1],result=[];while(result.length<1200){const key=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');result.push({month:key,amount:totals.get(key)||0});if(key>=last)break;if(++month>12){year++;month=1;}}return result.reverse();}
function drawMonthlyStats(){const root=$('monthly-chart');root.replaceChildren();if(!state.settingsReady){root.append(text('p','카드 설정을 불러오는 중입니다.'));return;}const data=monthlyTotals(includedRecords());if(!data.length){root.append(text('p','표시할 거래 내역이 없습니다.'));return;}const positive=Math.max(0,...data.map(x=>x.amount)),negative=Math.max(0,...data.map(x=>-x.amount)),span=positive+negative||1,zero=negative/span*100;root.append(text('p','총 '+data.length+'개월 · 최신 월부터 표시','muted'));for(const point of data){const row=text('div','','monthly-chart-row');const label=text('span',point.month);const track=text('div','','monthly-track');track.setAttribute('aria-hidden','true');const baseline=text('span','','monthly-zero');baseline.style.left=zero+'%';const bar=text('span','',point.amount<0?'monthly-bar negative':'monthly-bar');bar.style.left=(point.amount<0?zero-Math.abs(point.amount)/span*100:zero)+'%';bar.style.width=(Math.abs(point.amount)/span*100)+'%';track.append(baseline,bar);row.append(label,track,text('strong',won(point.amount)));root.append(row);}}
$('monthly-stats-button').onclick=()=>{drawMonthlyStats();$('monthly-stats').showModal();};
$('monthly-stats-close').onclick=()=>$('monthly-stats').close();
function syncPickerLabels(){for(const id of ['month','card']){const select=$(id);$(id+'-picker').textContent=select.selectedOptions[0]?.textContent||(id==='month'?'조회 월 없음':'전체 카드');$(id+'-picker').disabled=!select.options.length;}}
function openPicker(id){const select=$(id),dialog=$('quick-picker');$('picker-title').textContent=id==='month'?'조회 월 선택':'카드 선택';const list=$('picker-options');list.replaceChildren();for(const option of select.options){const button=text('button',option.textContent,'picker-option');button.type='button';button.setAttribute('aria-pressed',String(option.value===select.value));button.onclick=()=>{select.value=option.value;dialog.close();select.dispatchEvent(new Event('change',{bubbles:true}));};list.append(button);}dialog.showModal();list.querySelector('[aria-pressed="true"]')?.focus();}
$('month-picker').onclick=()=>openPicker('month');$('card-picker').onclick=()=>openPicker('card');$('picker-close').onclick=()=>$('quick-picker').close();
$('quick-picker').addEventListener('click',e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();});
$('google-login').onclick=()=>run(async()=>{const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await auth.signInWithPopup(provider);});
$('logout').onclick=()=>run(()=>auth.signOut());
$('backup-file').onchange=e=>{const f=e.target.files[0];if(f)run(()=>upload(f));e.target.value='';};
for(const id of ['month','card','search'])$(id).addEventListener(id==='search'?'input':'change',()=>{state.page=0;render();});
$('prev').onclick=()=>{state.page--;render();};$('next').onclick=()=>{state.page++;render();};
(async()=>{try{
 if(cfg.firebase.projectId.startsWith('REPLACE_'))throw Error('설정이 필요합니다. README의 Firebase 설정을 먼저 완료해 주세요.');
 firebase.initializeApp(cfg.firebase);auth=firebase.auth();db=firebase.firestore();await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
 function clearView(){settingsStop?.();settingsStop=null;state.settingsReady=false;state.excluded=[];state.nicknames={};state.role=null;$('admin-button').hidden=true;$('card-admin').close();$('quick-picker').close();$('monthly-stats').close();stop?.();stop=null;++generation;state.initialized=false;state.data={records:[],cards:[]};render();$('dashboard').hidden=true;$('login').hidden=false;}
 auth.onAuthStateChanged(user=>{
  accessStop?.();accessStop=null;clearView();$('logout').hidden=!user;
  if(!user)return;
  const identity=user.uid;
  accessStop=db.doc('access/'+user.email.toLowerCase()).onSnapshot(member=>{
   if(auth.currentUser?.uid!==identity)return;
   clearView();
   const permission=member.data();
   if(!permission?.enabled){notify('접근이 허용되지 않은 계정입니다. 관리자에게 등록을 요청해 주세요.',true);return;}
   notify('');$('dashboard').hidden=false;$('login').hidden=true;
   state.role=permission.role;
   $('backup-file').closest('label').hidden=permission.role!=='editor';
   settingsStop=db.doc('users/'+cfg.ledgerId+'/meta/cardSettings').onSnapshot(snapshot=>{if(auth.currentUser?.uid!==identity)return;const settings=snapshot.data()||{};state.excluded=Array.isArray(settings.excludedCardIds)?settings.excludedCardIds.map(String):[];state.nicknames=settings.nicknames||{};state.settingsReady=true;state.page=0;$('admin-button').hidden=state.role!=='editor';render();},()=>{state.settingsReady=false;$('admin-button').hidden=true;$('card-admin').close();render();notify('공통 카드 설정을 불러오지 못했습니다. 새로고침해 주세요.',true);});
   stop=db.doc('users/'+cfg.ledgerId+'/meta/current').onSnapshot(s=>{const ticket=++generation;loadSnapshot(s.data(),ticket).catch(e=>{if(ticket===generation)notify(e.message,true);});},()=>{clearView();notify('접근 권한이 없거나 연결이 해제되었습니다.',true);});
  },()=>{clearView();notify('접근이 허용되지 않았습니다. 관리자에게 확인해 주세요.',true);});
 });

}catch(e){notify(e.message,true);}finally{$('loading').hidden=true;}})();
