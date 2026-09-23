const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const initWasm=require('../public/vendor/sql-wasm.js');const init=options=>initWasm({...options,wasmBinary:fs.readFileSync(require.resolve('../public/vendor/sql-wasm.wasm'))});
async function parse(bytes){let resolve;const result=new Promise(r=>resolve=r);const ctx={Uint8Array,Map,Number,String,Error,URL,importScripts(){},initSqlJs:init,self:{postMessage:resolve,location:{href:"https://excude.github.io/expense_tracker/parse-worker.js?v=wasm-1"}}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/parse-worker.js'),'utf8'),ctx);await ctx.self.onmessage({data:bytes});return result;}
test('credit/debit only, hidden excluded, cancellation negative, Unicode',async()=>{const SQL=await init();const db=new SQL.Database();db.run('CREATE TABLE TABLE_CARDTAGS (_id INTEGER, nickname TEXT,card_name TEXT,card_no TEXT); INSERT INTO TABLE_CARDTAGS VALUES(1,"나의 카드","카드","1234"); CREATE TABLE TABLE_RECEIPT (_id INTEGER,ref_id INTEGER,nick TEXT,cname TEXT,ymd TEXT,time TEXT,paid INTEGER,storenew TEXT,store TEXT,status TEXT,div_month INTEGER,type INTEGER,hide INTEGER)');const s=db.prepare('INSERT INTO TABLE_RECEIPT VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const [id,type,hide,status,paid] of [[1,1,0,'승인',100],[2,2,0,'취소',30],[3,3,0,'승인',500],[4,1,1,'승인',700]])s.run([id,1,'','','2026-09-20','12:00',paid,'','가맹점',status,0,type,hide]);s.free();const data=await parse(db.export());db.close();assert.equal(data.records.length,2);assert.equal(data.records.reduce((s,r)=>s+r.amount,0),70);assert.equal(data.cards[0].name,'카드 · 1234');assert.equal(data.records[0].store,'가맹점');});
test('invalid SQLite is rejected',async()=>assert.ok((await parse(new Uint8Array([1,2,3]))).error));
test('chunk encoding roundtrip and commit fits request limit',()=>{const data=Buffer.alloc(6*1024*1024,255), encoded=data.toString('base64'),chunks=[];for(let i=0;i<encoded.length;i+=350000)chunks.push(encoded.slice(i,i+350000));assert.deepEqual(Buffer.from(chunks.join(''),'base64'),data);assert.ok(chunks.length<30);assert.ok(Buffer.byteLength(JSON.stringify(chunks))<9*1024*1024);});
test('Google verified account required; access list is never client writable',()=>{const rules=fs.readFileSync(require.resolve('../firestore.rules'),'utf8');assert.match(rules,/email_verified == true/);assert.match(rules,/sign_in_provider == 'google.com'/);assert.match(rules,/allow list, write: if false/);assert.match(rules,/role == 'editor'/);assert.doesNotMatch(rules,/if true/);});

if(process.env.BACKUP_PATH)test('provided backup card count',async()=>{const data=await parse(new Uint8Array(fs.readFileSync(process.env.BACKUP_PATH)));assert.equal(data.error,undefined);assert.equal(data.records.length,7520);assert.ok(data.cards.length<=47);});
test('Drive sync publishes chunks and pointer atomically; unchanged file skipped',()=>{
 const store={FIREBASE_API_KEY:'key',OWNER_UID:'owner',PROJECT_ID:'project',BACKUP_FOLDER_ID:'folder',REFRESH_TOKEN:'refresh'};let commits=0,writes;
 const file={getName:()=> 'backup.db',getLastUpdated:()=>new Date('2026-01-01'),getId:()=> 'file',getSize:()=>100,getBlob:()=>({getBytes:()=>Array.from(Buffer.from('SQLite format 3\0test'))})};
 const ctx={ScriptApp:{getOAuthToken:()=> 'google-token'},PropertiesService:{getScriptProperties:()=>({getProperty:k=>store[k],setProperty:(k,v)=>store[k]=v})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},DriveApp:{getFolderById:()=>{let first=true;return {getFiles:()=>({hasNext:()=>first,next:()=>{first=false;return file;}})}}},Utilities:{base64Encode:b=>Buffer.from(b).toString('base64'),getUuid:()=> 'snapshot'},UrlFetchApp:{fetch:(url,opts)=>{let data;if(url.includes('securetoken'))data={user_id:'owner',refresh_token:'r',id_token:'t'};else if(url.endsWith(':runQuery'))data=[];else if(url.endsWith(':commit')){commits++;writes=JSON.parse(opts.payload).writes;data={};}else throw Error('Unexpected URL');return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)};}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../bridge/Code.gs'),'utf8'),ctx);ctx.syncDrive();assert.equal(commits,1);assert.equal(writes.length,3);assert.ok(writes.at(-1).update.name.endsWith('/meta/current'));ctx.syncDrive();assert.equal(commits,1);
});
test('merged card exclusion survives grouping and clears when reenabled',()=>{
 const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
 const part=source.slice(source.indexOf('function cardExcluded'),source.indexOf('function updateCardOptions'));
 const state={settingsReady:false,excluded:['2'],data:{cards:[{id:1,sourceIds:['1','2']}],records:[{cardId:1,amount:100}]}};
 const ctx={state};vm.createContext(ctx);vm.runInContext(part,ctx);
 assert.equal(ctx.includedRecords().length,0);state.settingsReady=true;assert.equal(ctx.includedRecords().length,0);
 state.excluded=[];assert.equal(ctx.includedRecords().length,1);
 assert.match(source,/Persistence.LOCAL/);
});
test('only exact company and whole stored number merge; blank numbers remain separate',async()=>{
 const SQL=await init(),db=new SQL.Database();
 db.run('CREATE TABLE TABLE_CARDTAGS (_id INTEGER, nickname TEXT,card_name TEXT,card_no TEXT); CREATE TABLE TABLE_RECEIPT (_id INTEGER,ref_id INTEGER,nick TEXT,cname TEXT,ymd TEXT,time TEXT,paid INTEGER,storenew TEXT,store TEXT,status TEXT,div_month INTEGER,type INTEGER,hide INTEGER)');
 const tag=db.prepare('INSERT INTO TABLE_CARDTAGS VALUES(?,?,?,?)');
 const row=db.prepare('INSERT INTO TABLE_RECEIPT VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const cards=[[1,'A','1111234'],[2,'A','1111234'],[3,'A','2221234'],[4,'B','1111234'],[5,'A',''],[6,'A','']];
 for(const [id,company,number] of cards){tag.run([id,'',company,number]);row.run([id,id,'','','2026-09-01','12:00',100,'','store','승인',0,1,0]);}
 tag.free();row.free();const result=await parse(db.export());db.close();assert.equal(result.cards.length,5);assert.equal(result.records.length,6);assert.equal(result.records.reduce((s,r)=>s+r.amount,0),600);assert.equal(result.cards.find(c=>c.id===1).sourceIds.length,2);
});
test('month net ranking includes cancellations and shared nicknames',()=>{
 const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');const part=source.slice(source.indexOf('function nickname'),source.indexOf('function updateCardOptions'));
 const month={value:'2026-09'};const state={nicknames:{'9':'생활비'},data:{cards:[{id:1,name:'A',sourceIds:['1','9']},{id:2,name:'B'},{id:3,name:'C'}],records:[{cardId:1,date:'2026-09-01',amount:100},{cardId:1,date:'2026-09-02',amount:-90},{cardId:2,date:'2026-09-01',amount:50},{cardId:3,date:'2026-08-01',amount:999}]}};
 const ctx={state,$:()=>month};vm.createContext(ctx);vm.runInContext(part,ctx);const ranked=ctx.monthlyCards();assert.equal(ranked[0].card.id,2);assert.equal(ranked[1].amount,10);assert.equal(ranked[2].count,0);assert.equal(ctx.cardLabel(state.data.cards[0]),'생활비');month.value='2026-08';assert.equal(ctx.monthlyCards()[0].card.id,3);
});
