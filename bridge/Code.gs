// 매일 시간 트리거 + 관리자 전용 웹앱 POST로 드라이브 백업을 확인합니다.
function props_(){return PropertiesService.getScriptProperties();}
function setting_(key){const v=props_().getProperty(key);if(!v)throw Error('스크립트 속성이 필요합니다: '+key);return v;}
function request_(url,options){const r=UrlFetchApp.fetch(url,Object.assign({muteHttpExceptions:true},options));if(r.getResponseCode()>=300)throw Error('연결 실패 HTTP '+r.getResponseCode()+'. 프로젝트/로그인/규칙을 확인하세요.');return JSON.parse(r.getContentText()||'{}');}
function setup(){
 const properties=props_();
 if(!properties.getProperty('PROJECT_ID'))properties.setProperty('PROJECT_ID','fluent-sprite-509500-c0');
 if(!properties.getProperty('BACKUP_FOLDER_ID')){
  const folders=DriveApp.getFoldersByName('체리피커백업폴더(삭제시 백업/복구 불능)');
  if(!folders.hasNext())throw Error('백업 폴더를 찾지 못했습니다. 스크립트 속성 BACKUP_FOLDER_ID에 폴더 ID를 입력하세요.');
  const folder=folders.next();
  if(folders.hasNext())throw Error('같은 이름의 폴더가 여러 개입니다. BACKUP_FOLDER_ID를 직접 지정하세요.');
  properties.setProperty('BACKUP_FOLDER_ID',folder.getId());
 }

 syncDrive(); // 최초 동기화 성공 후 트리거를 생성합니다.
 ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncDrive').forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('syncDrive').timeBased().everyDays(1).atHour(4).nearMinute(15).inTimezone('Asia/Seoul').create();
}
function token_(){return ScriptApp.getOAuthToken();}
function field_(v){return typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v)};}
function update_(name,data){return {update:{name,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,field_(v)]))}};}
function commit_(root,token,writes){request_('https://firestore.googleapis.com/v1/'+root+':commit',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({writes})});}
function syncDrive(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {status:'busy'};
 try{
  const files=DriveApp.getFolderById(setting_('BACKUP_FOLDER_ID')).getFiles();let file;
  while(files.hasNext()){const f=files.next();if(/\.db$/i.test(f.getName())&&(!file||f.getLastUpdated()>file.getLastUpdated()))file=f;}
  if(!file)throw Error('폴더 안에서 .db 백업을 찾지 못했습니다.');
  const stamp=file.getId()+':'+file.getLastUpdated().getTime()+':'+file.getSize();
  const token=token_(), root='projects/'+setting_('PROJECT_ID')+'/databases/(default)/documents', base=root+'/users/shared';
  cleanup_(root,base,token);
  if(props_().getProperty('LAST_BACKUP')===stamp)return {status:'unchanged'};
  if(file.getSize()>6*1024*1024)throw Error('6MiB보다 큰 백업은 지원하지 않습니다. 이전 데이터는 유지됩니다.');
  const bytes=file.getBlob().getBytes();
  if(bytes.slice(0,15).map(b=>String.fromCharCode(b)).join('')!=='SQLite format 3')throw Error('SQLite 백업이 아닙니다.');
  const encoded=Utilities.base64Encode(bytes), snapshotId=Utilities.getUuid(), chunkCount=Math.ceil(encoded.length/350000), updatedAt=new Date().toISOString();
  const snapshot=base+'/snapshots/'+snapshotId, writes=[];
  for(let i=0;i<chunkCount;i++)writes.push(update_(snapshot+'/chunks/'+String(i).padStart(3,'0'),{index:i,payload:encoded.slice(i*350000,(i+1)*350000)}));
  writes.push(update_(snapshot,{chunkCount,updatedAt}));writes.push(update_(base+'/meta/current',{snapshotId,chunkCount,updatedAt,source:'drive'}));
  commit_(root,token,writes);props_().setProperty('LAST_BACKUP',stamp);return {status:'updated',snapshotId};
 }finally{lock.releaseLock();}
}
function cleanup_(root,base,token){
 const headers={Authorization:'Bearer '+token};
 const rows=request_('https://firestore.googleapis.com/v1/'+base+':runQuery',{method:'post',headers,contentType:'application/json',payload:JSON.stringify({structuredQuery:{from:[{collectionId:'snapshots'}],where:{fieldFilter:{field:{fieldPath:'updatedAt'},op:'LESS_THAN',value:{stringValue:new Date(Date.now()-86400000).toISOString()}}},limit:30}})});
 if(!rows.some(r=>r.document))return;
 const current=request_('https://firestore.googleapis.com/v1/'+base+'/meta/current',{headers});
 for(const row of rows){if(!row.document)continue;const d=row.document;if(d.name.endsWith('/'+current.fields.snapshotId.stringValue))continue;const count=Number(d.fields.chunkCount.integerValue);if(count>30||count<1)throw Error('백업 메타데이터 오류');const writes=[];for(let i=0;i<count;i++)writes.push({delete:d.name+'/chunks/'+String(i).padStart(3,'0')});writes.push({delete:d.name});commit_(root,token,writes);}
}

// Token claims are used only after Firestore has verified the ID token and Google-login rules.
function manualAccess_(idToken,requestId){
 if(typeof idToken!=='string'||idToken.length>10000||!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId))throw Error('잘못된 요청입니다.');
 const claims=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(idToken.split('.')[1])).getDataAsString());
 if(!claims.email||!claims.sub)throw Error('로그인이 필요합니다.');
 const root='projects/'+setting_('PROJECT_ID')+'/databases/(default)/documents';
 const headers={Authorization:'Bearer '+idToken};
 // This GET uses the caller's token, not the owner's OAuth token. Firestore verifies its signature,
 // project, expiry, Google provider, verified email, and ownership of the access document.
 const access=request_('https://firestore.googleapis.com/v1/'+root+'/access/'+encodeURIComponent(claims.email.toLowerCase()),{headers});
 if(access.fields?.enabled?.booleanValue!==true||access.fields?.role?.stringValue!=='editor')throw Error('관리자 권한이 필요합니다.');
 const name=root+'/users/shared/meta/driveCheck';
 const pending=request_('https://firestore.googleapis.com/v1/'+name,{headers});
 const f=pending.fields||{};
 if(f.requestId?.stringValue!==requestId||f.requestedBy?.stringValue!==claims.sub||f.status?.stringValue!=='queued')throw Error('만료되었거나 처리된 요청입니다.');
 const age=Date.now()-Date.parse(f.createdAt?.timestampValue||'');
 if(!Number.isFinite(age)||age< -10000||age>120000)throw Error('요청 시간이 만료되었습니다. 다시 눌러 주세요.');
 return {root,name};
}
function doPost(e){
 let context;
 const p=e?.parameter||{};
 try{
  context=manualAccess_(p.idToken,p.requestId);
  const result=syncDrive();
  const messages={updated:'새 드라이브 백업을 반영했습니다.',unchanged:'새 백업이 없습니다. 드라이브 최신 파일입니다.',busy:'다른 동기화가 실행 중입니다. 잠시 후 다시 눌러 주세요.'};
  // Use an update mask so a concurrent administrator's newer request cannot be replaced.
  const token=token_();
  const current=request_('https://firestore.googleapis.com/v1/'+context.name,{headers:{Authorization:'Bearer '+token}});
  if(current.fields?.requestId?.stringValue===p.requestId){
   const data={status:result.status,message:messages[result.status],finishedAt:new Date().toISOString()};
   const write=update_(context.name,data);write.updateMask={fieldPaths:Object.keys(data)};
   write.currentDocument={updateTime:current.updateTime};commit_(context.root,token,[write]);
  }
 }catch(error){
  if(context){
   try{
    const token=token_(),current=request_('https://firestore.googleapis.com/v1/'+context.name,{headers:{Authorization:'Bearer '+token}});
    if(current.fields?.requestId?.stringValue===p.requestId){
     const data={status:'error',message:String(error.message||'드라이브 확인에 실패했습니다.').slice(0,300),finishedAt:new Date().toISOString()};
     const write=update_(context.name,data);write.updateMask={fieldPaths:Object.keys(data)};write.currentDocument={updateTime:current.updateTime};commit_(context.root,token,[write]);
    }
   }catch(ignored){}
  }
 }
 // Browser receives an opaque response; authenticated Firestore reports the outcome.
 return ContentService.createTextOutput('요청 처리가 끝났습니다. 사이트에서 결과를 확인하세요.');
}
function doGet(){return ContentService.createTextOutput('체리 가계부 사이트의 관리자 드라이브 체크 버튼을 사용하세요.');}
