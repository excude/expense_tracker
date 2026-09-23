importScripts('./vendor/sql-wasm.js');
self.onmessage = async ({data}) => {
 let db;
 try {
  const SQL=await initSqlJs({locateFile:file=>new URL('./vendor/'+file,self.location.href).href}); db=new SQL.Database(new Uint8Array(data));
  const query=sql=>{const statement=db.prepare(sql), rows=[];try{while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}};
  const tags=query('SELECT * FROM TABLE_CARDTAGS');
  const identities=new Map(), byId=new Map();
  for(const c of [...tags].sort((a,b)=>a._id-b._id)){
   const company=String(c.card_name||''), number=String(c.card_no||'');
   const key=company.trim()&&number.trim()?JSON.stringify([company,number]):'id:'+c._id;
   if(!identities.has(key))identities.set(key,{id:c._id,name:(company||c.nickname||'카드')+(number?' · '+number:''),sourceIds:[]});
   const group=identities.get(key);group.sourceIds.push(String(c._id));byId.set(c._id,group);
  }
  const records=query('SELECT * FROM TABLE_RECEIPT WHERE type IN (1,2) AND hide=0 ORDER BY ymd DESC,time DESC,_id DESC').map(r=>({id:r._id,cardId:byId.get(r.ref_id)?.id??r.ref_id,card:byId.get(r.ref_id)?.name||r.nick||r.cname||'카드',date:String(r.ymd||''),time:String(r.time||''),amount:r.status==='취소'?-Math.abs(Number(r.paid)):Number(r.paid),store:r.storenew||r.store||'',status:r.status||'',installments:Number(r.div_month)||0}));
  if(records.some(r=>!Number.isFinite(r.amount)))throw Error('금액 형식이 올바르지 않습니다.');
  const cards=[...new Map(records.map(r=>[r.cardId,byId.get(r.cardId)||{id:r.cardId,name:r.card,sourceIds:[String(r.cardId)]}])).values()];
  self.postMessage({records,cards,latestMonth:records[0]?.date.slice(0,7)||''});
 }catch(e){self.postMessage({error:'체리피커 백업을 읽을 수 없습니다. '+e.message});}finally{db?.close();}
};
