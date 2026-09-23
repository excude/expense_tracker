// 이 스크립트는 웹앱으로 배포하지 않습니다. 본인 계정의 시간 트리거로 실행합니다.
function props_(){return PropertiesService.getScriptProperties();}
function setting_(key){const v=props_().getProperty(key);if(!v)throw Error('스크립트 속성이 필요합니다: '+key);return v;}
function request_(url,options){const r=UrlFetchApp.fetch(url,Object.assign({muteHttpExceptions:true},options));if(r.getResponseCode()>=300)throw Error('연결 실패 HTTP '+r.getResponseCode()+'. 프로젝트/로그인/규칙을 확인하세요.');return JSON.parse(r.getContentText()||'{}');}
function setup(){
 syncDrive(); // 최초 동기화 성공 후 트리거를 생성합니다.
 ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncDrive').forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('syncDrive').timeBased().everyMinutes(15).create();
}
function token_(){return ScriptApp.getOAuthToken();}
function field_(v){return typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v)};}
function update_(name,data){return {update:{name,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,field_(v)]))}};}
function commit_(root,token,writes){request_('https://firestore.googleapis.com/v1/'+root+':commit',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({writes})});}
function syncDrive(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  const files=DriveApp.getFolderById(setting_('BACKUP_FOLDER_ID')).getFiles();let file;
  while(files.hasNext()){const f=files.next();if(/\.db$/i.test(f.getName())&&(!file||f.getLastUpdated()>file.getLastUpdated()))file=f;}
  if(!file)throw Error('폴더 안에서 .db 백업을 찾지 못했습니다.');
  const stamp=file.getId()+':'+file.getLastUpdated().getTime()+':'+file.getSize();
  const token=token_(), root='projects/'+setting_('PROJECT_ID')+'/databases/(default)/documents', base=root+'/users/shared';
  cleanup_(root,base,token);
  if(props_().getProperty('LAST_BACKUP')===stamp)return;
  if(file.getSize()>6*1024*1024)throw Error('6MiB보다 큰 백업은 지원하지 않습니다. 이전 데이터는 유지됩니다.');
  const bytes=file.getBlob().getBytes();
  if(bytes.slice(0,15).map(b=>String.fromCharCode(b)).join('')!=='SQLite format 3')throw Error('SQLite 백업이 아닙니다.');
  const encoded=Utilities.base64Encode(bytes), snapshotId=Utilities.getUuid(), chunkCount=Math.ceil(encoded.length/350000), updatedAt=new Date().toISOString();
  const snapshot=base+'/snapshots/'+snapshotId, writes=[];
  for(let i=0;i<chunkCount;i++)writes.push(update_(snapshot+'/chunks/'+String(i).padStart(3,'0'),{index:i,payload:encoded.slice(i*350000,(i+1)*350000)}));
  writes.push(update_(snapshot,{chunkCount,updatedAt}));writes.push(update_(base+'/meta/current',{snapshotId,chunkCount,updatedAt,source:'drive'}));
  commit_(root,token,writes);props_().setProperty('LAST_BACKUP',stamp);
 }finally{lock.releaseLock();}
}
function cleanup_(root,base,token){
 const headers={Authorization:'Bearer '+token};
 const rows=request_('https://firestore.googleapis.com/v1/'+base+':runQuery',{method:'post',headers,contentType:'application/json',payload:JSON.stringify({structuredQuery:{from:[{collectionId:'snapshots'}],where:{fieldFilter:{field:{fieldPath:'updatedAt'},op:'LESS_THAN',value:{stringValue:new Date(Date.now()-86400000).toISOString()}}},limit:30}})});
 if(!rows.some(r=>r.document))return;
 const current=request_('https://firestore.googleapis.com/v1/'+base+'/meta/current',{headers});
 for(const row of rows){if(!row.document)continue;const d=row.document;if(d.name.endsWith('/'+current.fields.snapshotId.stringValue))continue;const count=Number(d.fields.chunkCount.integerValue);if(count>30||count<1)throw Error('백업 메타데이터 오류');const writes=[];for(let i=0;i<count;i++)writes.push({delete:d.name+'/chunks/'+String(i).padStart(3,'0')});writes.push({delete:d.name});commit_(root,token,writes);}
}
