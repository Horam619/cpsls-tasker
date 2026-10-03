// CPSLS Tasker — web app for iPhone and Mac, synced through Firebase, briefings by Gemini.
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
         sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection,
         onSnapshot, setDoc, updateDoc, deleteDoc, getDocFromServer, writeBatch } from "firebase/firestore";

const CATS = {tiktok:"TikTok", instagram:"Instagram", design:"Design", production:"Produktion", business:"Business"};
const WD = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const DEFAULT_MODEL = "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const CONFIG_KEY = "cpsls-firebase-config";

const S = {phase:"boot", view:"today", filter:"all", tasks:[], profile:{}, settings:{model:DEFAULT_MODEL, geminiKey:""},
           brief:null, briefDay:"", tasksLoaded:false, userLoaded:false, generating:false, briefError:"",
           openIds:new Set(), autoTriedFor:"", authError:"", authBusy:false, user:null, online:navigator.onLine};
let fb = null;          // {app, auth, db}
let unsubs = [];        // live listeners for the signed-in user
let briefUnsub = null;

const today = () => new Date().toLocaleDateString("sv");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtDue = d => { if(!d) return ""; const [,m,dd]=d.split("-"); return dd+"."+m+"."; };
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $ = s => document.querySelector(s);
const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }, del(k){ try{ localStorage.removeItem(k); }catch(e){} } };

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2400); }
const fail = () => toast("Nicht gespeichert. Prüfe deine Verbindung.");

/* ---------- Firebase ---------- */
// Accepts the snippet copied from the Firebase console (JS object or JSON).
function parseConfig(text){
  const want=["apiKey","authDomain","projectId","storageBucket","messagingSenderId","appId"], cfg={};
  for(const k of want){
    const m=text.match(new RegExp('["\']?'+k+'["\']?\\s*:\\s*["\']([^"\']+)["\']'));
    if(m) cfg[k]=m[1];
  }
  return cfg.apiKey && cfg.projectId && cfg.appId ? cfg : null;
}
function startFirebase(cfg){
  const app=initializeApp(cfg);
  const auth=getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(()=>{});
  let db;
  try{ db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})}); }
  catch(e){ db=initializeFirestore(app,{}); }
  fb={app,auth,db};
  onAuthStateChanged(auth, user=>{
    unsubs.forEach(u=>u()); unsubs=[]; if(briefUnsub){ briefUnsub(); briefUnsub=null; }
    S.user=user; S.tasks=[]; S.brief=null; S.tasksLoaded=false; S.userLoaded=false; S.autoTriedFor="";
    if(!user){ S.phase="auth"; render(); return; }
    S.phase="app"; render();
    const base=["users",user.uid];
    unsubs.push(onSnapshot(doc(db,...base), snap=>{
      const d=snap.exists()?snap.data():{};
      S.profile=d.profile||{}; S.settings=Object.assign({model:DEFAULT_MODEL, geminiKey:""}, d.settings||{});
      S.userLoaded=true; render(); maybeAutoBrief();
    }, ()=>{}));
    unsubs.push(onSnapshot(collection(db,...base,"tasks"), snap=>{
      S.tasks=snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
      const first=!S.tasksLoaded; S.tasksLoaded=true;
      if(first && snap.empty && !snap.metadata.fromCache) seedExamples();
      render(); maybeAutoBrief();
    }, ()=>{}));
    watchBrief();
  });
}
function userRef(...p){ return doc(fb.db,"users",S.user.uid,...p); }
function watchBrief(){
  const d=today();
  if(briefUnsub && S.briefDay===d) return;
  if(briefUnsub) briefUnsub();
  S.briefDay=d; S.brief=null;
  briefUnsub=onSnapshot(userRef("briefs",d), snap=>{ if(!S.generating){ S.brief=snap.exists()?snap.data():null; render(); } maybeAutoBrief(); }, ()=>{});
}

/* ---------- task ops ---------- */
function addTask(t){
  const task=Object.assign({title:"",note:"",category:"business",priority:"normal",due:"",done:false,source:"self",createdAt:Date.now()}, t);
  const id=task.id||uid(); delete task.id;
  setDoc(userRef("tasks",id), task).catch(fail);
}
function patchTask(id, patch){ updateDoc(userRef("tasks",id), patch).catch(fail); }
function removeTasks(list){
  const b=writeBatch(fb.db); list.slice(0,450).forEach(t=>b.delete(userRef("tasks",t.id))); b.commit().catch(fail);
}
function seedExamples(){
  const t=today(), add=n=>{const x=new Date(); x.setDate(x.getDate()+n); return x.toLocaleDateString("sv");};
  const ex=[
    {id:"ex-1",title:"Drop-Teaser für TikTok drehen: Stoffdetail in Makro",note:"Beispiel. 7 Sekunden, nur Textur und Nähte, kein Gesicht. Hook: Ton des Reißverschlusses in Sekunde 1.",category:"tiktok",priority:"high",due:t},
    {id:"ex-2",title:"Instagram-Carousel: 5 Looks aus der neuen Kollektion",note:"Beispiel. Weißer Hintergrund, gleiche Kamerahöhe für alle Bilder, letzte Slide mit Drop-Datum.",category:"instagram",priority:"normal",due:add(1)},
    {id:"ex-3",title:"Hangtag-Entwurf finalisieren",note:"Beispiel. Logo in Prägung, Materialangabe auf der Rückseite, Freigabe an die Druckerei.",category:"design",priority:"normal",due:add(4)},
    {id:"ex-4",title:"Muster-Feedback an Produzent schicken",note:"Beispiel. Ärmellänge Gr. M um 1 cm kürzen, Saumweite prüfen.",category:"production",priority:"high",due:add(-1)}];
  const b=writeBatch(fb.db);
  ex.forEach((x,i)=>{ const id=x.id; const data=Object.assign({},x,{done:false,source:"self",example:true,createdAt:i+1}); delete data.id; b.set(userRef("tasks",id),data); });
  b.commit().catch(()=>{});
}

/* ---------- Gemini ---------- */
function buildPrompt(){
  const p=S.profile||{};
  const open=S.tasks.filter(t=>!t.done).slice(0,40).map(t=>"- ["+(CATS[t.category]||t.category)+"] "+t.title).join("\n")||"(keine)";
  const done=S.tasks.filter(t=>t.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).slice(0,15).map(t=>"- "+t.title).join("\n")||"(keine)";
  const d=new Date();
  return `Du bist Creative Director und Brand-Stratege einer Modemarke. Erstelle das Tages-Briefing für ${WD[d.getDay()]}, ${d.toLocaleDateString("de-DE")}.

MARKE
Name: ${p.name||"(nicht angegeben)"}
Positionierung: ${p.positioning||"(nicht angegeben)"}
Zielgruppe: ${p.audience||"(nicht angegeben)"}
Tonalität / Ästhetik: ${p.tone||"(nicht angegeben)"}
Aktuelle Kollektion / Drop: ${p.drop||"(nicht angegeben)"}
Kanäle & Ziele: ${p.channels||"TikTok, Instagram"}
Weitere Notizen: ${p.notes||"-"}

OFFENE AUFGABEN (nicht wiederholen):
${open}

ZULETZT ERLEDIGT:
${done}

Liefere 7 konkrete, heute umsetzbare Aufgaben auf Deutsch: 3 TikTok (Format, Hook in den ersten 2 Sekunden, Länge), 2 Instagram (Reel, Carousel oder Story), 1 Design (Grafik, Print, Detail, Moodboard) und 1 Produktion oder Business. Beachte Wochentag und Saison. Keine Allgemeinplätze.
Jede Aufgabe: "title" (Imperativ, max. 70 Zeichen), "note" (2–3 Sätze: Idee, Hook bzw. Ausführung, Ergebnis), "category" (eine von: tiktok, instagram, design, production, business), "priority" ("high" für höchstens 2 Aufgaben, sonst "normal").
Antworte nur mit JSON in dieser Form:
{"focus":"Ein Satz zum Tagesfokus","items":[{"title":"…","note":"…","category":"tiktok","priority":"high"}]}`;
}
async function askGemini(prompt, model, key){
  let r;
  try{
    r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST", headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}], generationConfig:{temperature:0.9, responseMimeType:"application/json"}})});
  }catch(e){ throw {status:0, message:""}; }
  const raw=await r.text(); let body=null; try{ body=JSON.parse(raw); }catch(e){}
  if(!r.ok) throw {status:r.status, message:(body&&body.error&&body.error.message)||raw};
  const c=((body||{}).candidates||[])[0]||{};
  const text=((c.content&&c.content.parts)||[]).map(p=>p.text||"").join("");
  if(!text) throw {status:200, message:"Leere Antwort"};
  return text;
}
function parseJSON(text){
  try{ return JSON.parse(text); }catch(e){}
  const a=text.indexOf("{"), b=text.lastIndexOf("}");
  if(a>=0&&b>a){ try{ return JSON.parse(text.slice(a,b+1)); }catch(e){} }
  return null;
}
function errorText(e){
  const s=e&&e.status;
  if(s===0) return "Keine Verbindung zu Gemini. Prüfe deine Internetverbindung.";
  if(s===400 && /API key/i.test(e.message||"")) return "Der Gemini-Schlüssel ist ungültig. Prüfe ihn im Setup.";
  if(s===401||s===403) return "Der Gemini-Schlüssel wurde abgelehnt. Prüfe ihn im Setup.";
  if(s===404) return "Das Gemini-Modell wurde nicht gefunden. Wähle im Setup ein anderes.";
  if(s===429) return "Das kostenlose Gemini-Limit ist für den Moment erreicht. Versuch es später erneut.";
  return "Das Briefing konnte nicht erstellt werden"+(e&&e.message?": "+String(e.message).slice(0,160):".");
}
async function generateBrief(auto){
  if(S.generating) return;
  const key=S.settings.geminiKey;
  if(!key){ S.briefError="Hinterlege zuerst deinen kostenlosen Gemini-Schlüssel im Setup."; render(); return; }
  const d=today();
  if(auto){ // the other device may already have written today's briefing
    try{ const snap=await getDocFromServer(userRef("briefs",d)); if(snap.exists()) return; }catch(e){ return; }
  }
  S.generating=true; S.briefError=""; render();
  const model=S.settings.model||DEFAULT_MODEL;
  try{
    let text;
    try{ text=await askGemini(buildPrompt(), model, key); }
    catch(e){ if((e.status===404||e.status===429) && model!==FALLBACK_MODEL) text=await askGemini(buildPrompt(), FALLBACK_MODEL, key); else throw e; }
    const r=parseJSON(text);
    const items=(Array.isArray(r&&r.items)?r.items:[]).filter(x=>x&&x.title).slice(0,10).map(x=>({
      id:uid(), title:String(x.title).slice(0,120), note:String(x.note||"").slice(0,600),
      category:CATS[x.category]?x.category:"business", priority:x.priority==="high"?"high":"normal", status:"new"}));
    if(!items.length) throw {status:200, message:"Die Antwort enthielt keine Aufgaben"};
    const brief={date:d, focus:String((r&&r.focus)||"").slice(0,240), items, generatedAt:Date.now(), model};
    S.brief=brief;
    await setDoc(userRef("briefs",d), brief);
  }catch(e){ S.briefError=e&&e.status!==undefined?errorText(e):"Das Briefing konnte nicht gespeichert werden."; }
  S.generating=false; render();
}
function maybeAutoBrief(){
  const t=today();
  if(S.phase!=="app" || !S.userLoaded || !S.tasksLoaded || !S.settings.geminiKey || S.generating || S.brief || S.autoTriedFor===t || !navigator.onLine) return;
  S.autoTriedFor=t; generateBrief(true);
}
function decide(itemId, accept){
  const b=S.brief; if(!b) return;
  const items=b.items.map(i=>i.id===itemId?Object.assign({},i,{status:accept?"accepted":"dismissed"}):i);
  const it=b.items.find(i=>i.id===itemId);
  if(accept && it){ addTask({id:"ai-"+it.id,title:it.title,note:it.note,category:it.category,priority:it.priority,due:today(),source:"ai"}); toast("Übernommen"); }
  S.brief=Object.assign({},b,{items}); render();
  updateDoc(userRef("briefs",b.date),{items}).catch(fail);
}
function acceptAll(){
  const b=S.brief; if(!b) return;
  const batch=writeBatch(fb.db);
  b.items.filter(i=>i.status==="new").forEach(it=>batch.set(userRef("tasks","ai-"+it.id),
    {title:it.title,note:it.note,category:it.category,priority:it.priority,due:today(),done:false,source:"ai",createdAt:Date.now()}));
  const items=b.items.map(i=>i.status==="new"?Object.assign({},i,{status:"accepted"}):i);
  batch.update(userRef("briefs",b.date),{items});
  S.brief=Object.assign({},b,{items}); render();
  batch.commit().then(()=>toast("Alle übernommen")).catch(fail);
}

/* ---------- push reminders ---------- */
const VAPID_PUBLIC = "BDZnWoCrJtRiIrnEzkkdxMgDvj8zM-10OJijZiSbOUR5Ad_P-UV8m-SSrB6zhV-jcOq3MX5dijjZsjan3xcBcHI";
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && location.protocol==="https:";
function pushStatus(){
  if(!pushSupported()) return isIOS()&&!isStandalone() ? "Nur in der Home-Bildschirm-App" : "Nicht verfügbar";
  if(Notification.permission==="denied") return "In den Mitteilungen blockiert";
  return ls.get("cpsls-push-on")==="1" && Notification.permission==="granted" ? "Aktiv auf diesem Gerät" : "Aus";
}
function b64ToBytes(b64){ const p="=".repeat((4-b64.length%4)%4), s=atob((b64+p).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(s,c=>c.charCodeAt(0)); }
async function subId(sub){ const h=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint)); return Array.from(new Uint8Array(h)).slice(0,12).map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function enablePush(){
  const st=$("#push-state");
  try{
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){ st.textContent="Mitteilungen nicht erlaubt"; return; }
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToBytes(VAPID_PUBLIC)});
    await setDoc(userRef("push",await subId(sub)), {subscription:JSON.parse(JSON.stringify(sub)), device:isIOS()?"iPhone":navigator.platform||"Gerät", createdAt:Date.now()});
    ls.set("cpsls-push-on","1"); st.textContent="Aktiv auf diesem Gerät"; toast("Erinnerungen aktiviert");
  }catch(e){ st.textContent="Konnte nicht aktiviert werden"; }
}
async function disablePush(){
  try{
    const reg=await navigator.serviceWorker.ready, sub=await reg.pushManager.getSubscription();
    if(sub){ await deleteDoc(userRef("push",await subId(sub))); await sub.unsubscribe(); }
  }catch(e){}
  ls.del("cpsls-push-on"); const st=$("#push-state"); if(st) st.textContent="Aus"; toast("Erinnerungen aus");
}

/* ---------- views ---------- */
function sortTasks(list){
  return list.slice().sort((a,b)=> (a.done-b.done) || ((b.priority==="high")-(a.priority==="high")) ||
    ((a.due||"9999").localeCompare(b.due||"9999")) || ((a.createdAt||0)-(b.createdAt||0)));
}
function taskRow(t){
  const late=t.due && !t.done && t.due<today();
  return `<li class="task${t.done?" done":""}${S.openIds.has(t.id)?" open":""}" data-id="${esc(t.id)}">
    <button class="chk" data-act="toggle" aria-label="${t.done?"Als offen markieren":"Als erledigt markieren"}"></button>
    <div class="t-main" data-act="expand">
      <div class="t-title">${esc(t.title)}</div>
      ${t.note?`<div class="t-note">${esc(t.note)}</div>`:""}
    </div>
    <div class="t-meta">
      <span class="tag${t.priority==="high"?" hi":""}">${esc(CATS[t.category]||t.category)}</span>
      ${t.example?`<span class="tag ex">Beispiel</span>`:""}
      ${t.due?`<span class="mono due${late?" late":""}">${late?"Überfällig · ":""}${fmtDue(t.due)}</span>`:""}
      ${t.source==="ai"?`<span class="mono">KI</span>`:""}
    </div>
    <button class="del" data-act="delete" aria-label="Löschen">×</button>
  </li>`;
}
function composer(){
  const opts=Object.entries(CATS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  return `<form class="composer" id="composer" autocomplete="off">
    <input type="text" id="new-title" placeholder="Neue Aufgabe, z. B. Lookbook-Shooting planen" aria-label="Aufgabe">
    <select id="new-cat" aria-label="Kategorie">${opts}</select>
    <input type="date" id="new-due" aria-label="Fällig am" value="${today()}">
    <label class="prio"><input type="checkbox" id="new-prio"> Priorität</label>
    <button class="btn" type="submit">Hinzufügen</button>
  </form>`;
}
function briefBlock(){
  const b=S.brief; let body="";
  if(S.generating){
    body=`<div class="loading"><div class="bar"></div><span class="mono">Gemini schreibt dein Briefing</span></div>`;
  } else if(b){
    const open=b.items.filter(i=>i.status==="new").length;
    body=`${b.focus?`<p class="brief-focus">${esc(b.focus)}</p>`:""}
      <div class="proposals">${b.items.map(i=>`
        <article class="prop ${i.status}">
          <div class="p-top"><span class="tag${i.priority==="high"?" hi":""}">${esc(CATS[i.category]||i.category)}</span></div>
          <h3>${esc(i.title)}</h3>
          <p>${esc(i.note)}</p>
          <div class="p-act">
            <button class="btn" data-brief="accept" data-item="${esc(i.id)}">Übernehmen</button>
            <button class="link" data-brief="dismiss" data-item="${esc(i.id)}">Verwerfen</button>
          </div>
          ${i.status==="accepted"?`<span class="state">In deinen Aufgaben</span>`:i.status==="dismissed"?`<span class="state">Verworfen</span>`:""}
        </article>`).join("")}
      </div>
      ${open?`<div style="margin-top:16px"><button class="link" data-brief="all">Alle ${open} übernehmen</button></div>`:""}`;
  } else if(!S.settings.geminiKey){
    body=`<p class="empty"><b>Gemini ist noch nicht verbunden.</b> Hol dir einen kostenlosen Schlüssel bei Google AI Studio und trag ihn im Setup ein. Danach bekommst du jeden Morgen sieben neue Aufgaben, auf Mac und iPhone.</p>
      <button class="btn" data-go="settings">Gemini verbinden</button>`;
  } else {
    body=`<p class="empty"><b>Noch kein Briefing für heute.</b> Gemini schlägt dir jeden Tag sieben Aufgaben für TikTok, Instagram, Design und Business vor. Je genauer dein Markenprofil, desto präziser die Ideen.</p>`;
  }
  const hasKey=!!S.settings.geminiKey;
  return `<section class="block">
    <div class="block-head"><h2>KI-Briefing</h2>
      <div class="head-actions">
        ${!S.profile.name?`<button class="link" data-go="brand">Markenprofil ausfüllen</button>`:""}
        <button class="btn ghost" data-brief="gen" ${hasKey&&!S.generating?"":"disabled"}>${b?"Neu generieren":"Briefing erstellen"}</button>
      </div></div>
    ${S.briefError?`<p class="notice">${esc(S.briefError)}</p>`:""}
    ${body}
  </section>`;
}
function viewToday(){
  const d=new Date(), t=today();
  const open=S.tasks.filter(x=>!x.done);
  const focus=sortTasks(open.filter(x=>(x.due&&x.due<=t)||x.priority==="high"));
  const doneToday=S.tasks.filter(x=>x.done && x.doneAt && new Date(x.doneAt).toLocaleDateString("sv")===t);
  const late=open.filter(x=>x.due&&x.due<t).length;
  return `<div class="topline"><span class="mono">${esc(S.profile.name||"Deine Marke")}</span><span class="mono">KW ${isoWeek(d)}</span></div>
    <h1 class="hero">${WD[d.getDay()]}</h1>
    <div class="hero-meta mono"><span><b>${d.toLocaleDateString("de-DE",{day:"2-digit",month:"long",year:"numeric"})}</b></span>
      <span><b>${focus.length}</b> im Fokus</span><span><b>${open.length}</b> offen</span>${late?`<span><b>${late}</b> überfällig</span>`:""}<span><b>${doneToday.length}</b> heute erledigt</span></div>
    ${composer()}
    ${briefBlock()}
    <section class="block">
      <div class="block-head"><h2>Heute im Fokus</h2><button class="link" data-go="all">Alle Aufgaben</button></div>
      ${focus.length?`<ul class="tasks">${focus.map(taskRow).join("")}</ul>`:
        `<p class="empty">${S.tasksLoaded?"Nichts fällig. Übernimm Vorschläge aus dem Briefing oder schreib oben eine Aufgabe ein.":"Aufgaben werden geladen …"}</p>`}
    </section>
    ${doneToday.length?`<section class="block"><div class="block-head"><h2>Heute erledigt</h2></div><ul class="tasks">${doneToday.map(taskRow).join("")}</ul></section>`:""}`;
}
function viewAll(){
  const list=S.filter==="all"?S.tasks:S.tasks.filter(t=>t.category===S.filter);
  const open=sortTasks(list.filter(t=>!t.done)), done=sortTasks(list.filter(t=>t.done));
  const chips=[["all","Alle"]].concat(Object.entries(CATS)).map(([k,v])=>{
    const n=(k==="all"?S.tasks:S.tasks.filter(t=>t.category===k)).filter(t=>!t.done).length;
    return `<button class="chip" data-filter="${k}" aria-pressed="${S.filter===k}">${v} ${n}</button>`;}).join("");
  const hasEx=S.tasks.some(t=>t.example);
  return `<div class="topline"><span class="mono">Aufgaben</span><span class="mono">${S.tasks.length} gesamt</span></div>
    <h1 class="hero">Aufgaben</h1>
    ${composer()}
    <div class="chips">${chips}</div>
    <section class="block">
      <div class="block-head"><h2>Offen</h2>${hasEx?`<button class="link" data-global="clear-examples">Beispiele entfernen</button>`:""}</div>
      ${open.length?`<ul class="tasks">${open.map(taskRow).join("")}</ul>`:`<p class="empty">Keine offenen Aufgaben in dieser Kategorie.</p>`}
    </section>
    ${done.length?`<section class="block"><div class="block-head"><h2>Erledigt</h2><button class="link" data-global="clear-done">Erledigte löschen</button></div><ul class="tasks">${done.map(taskRow).join("")}</ul></section>`:""}`;
}
function viewBrand(){
  const p=S.profile||{};
  const f=(id,label,ph,wide,area)=>`<div class="field${wide?" wide":""}"><label for="b-${id}">${label}</label>${area?
    `<textarea id="b-${id}" placeholder="${esc(ph)}">${esc(p[id])}</textarea>`:`<input id="b-${id}" type="text" placeholder="${esc(ph)}" value="${esc(p[id])}">`}</div>`;
  return `<div class="topline"><span class="mono">Markenprofil</span><span class="mono">Grundlage für das KI-Briefing</span></div>
    <h1 class="hero">Marke</h1>
    <form class="form" id="brand-form">
      ${f("name","Markenname","z. B. CPSLS")}
      ${f("drop","Aktuelle Kollektion / Drop","z. B. FW26 ‚Concrete‘, Release 24.10.")}
      ${f("positioning","Positionierung","z. B. Oversized Tailoring, Streetwear mit Couture-Details",true,true)}
      ${f("audience","Zielgruppe","z. B. 20–32, urban, DACH, kauft über Instagram",false,true)}
      ${f("tone","Tonalität & Ästhetik","z. B. kühl, reduziert, ironisch, Schwarz-Weiß",false,true)}
      ${f("channels","Kanäle & Ziele","z. B. TikTok 3×/Woche, Instagram Reels, Ziel: Drop-Warteliste",true,true)}
      ${f("notes","Weitere Notizen","Produktion, Lieferanten, Termine, No-Gos …",true,true)}
      <div class="form-foot"><button class="btn" type="submit">Profil speichern</button></div>
    </form>`;
}
function viewTechpack(){
  const rows=[["A","Brustbreite","1/2"],["B","Vordere Länge ab HPS","1"],["C","Schulterbreite","1/2"],["D","Ärmellänge","1"],["E","Saumweite","1/2"]];
  return `<div class="topline"><span class="mono">Modul</span><span class="mono">In Vorbereitung</span></div>
    <h1 class="hero">Tech Packs</h1>
    <p class="soon">Hier wird deine Tech-Pack-App angebunden. Dann kannst du aus einer Design-Aufgabe direkt ein Tech Pack erzeugen und den Status der Muster hier verfolgen.</p>
    <div class="sheet" aria-label="Vorschau eines Tech Packs">
      <div class="sheet-head">
        <div><span class="mono">Style-Nr.</span><b>—</b></div>
        <div><span class="mono">Saison</span><b>${esc((S.profile.drop||"").split(/[ ,]/)[0]||"—")}</b></div>
        <div><span class="mono">Größenlauf</span><b>XS–XL</b></div>
        <div><span class="mono">Status</span><b>Entwurf</b></div>
      </div>
      <div class="pom-wrap"><table class="pom">
        <thead><tr><th>POM</th><th>Messpunkt</th><th>Tol. ±&nbsp;cm</th><th>S</th><th>M</th><th>L</th></tr></thead>
        <tbody>${rows.map(r=>`<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="ph">—</td><td class="ph">—</td><td class="ph">—</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="sheet-foot"><span class="mono" style="color:var(--mute)">Verbindung zur Tech-Pack-App folgt</span><button class="btn ghost" disabled>Tech Pack erstellen</button></div>
    </div>`;
}
function viewSettings(){
  const k=S.settings.geminiKey, masked=k?k.slice(0,4)+"••••••••"+k.slice(-4):"";
  return `<div class="topline"><span class="mono">Setup</span><span class="mono">${esc(S.user?S.user.email:"")}</span></div>
    <h1 class="hero">Setup</h1>
    <section class="block">
      <div class="block-head"><h2>Gemini verbinden</h2><span class="mono muted">${k?"Verbunden: "+esc(masked):"Nicht verbunden"}</span></div>
      <ol class="steps">
        <li>Öffne <a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> und melde dich mit deinem Google-Konto an.</li>
        <li>Tippe auf „Create API key“. Der kostenlose Tarif reicht für das tägliche Briefing.</li>
        <li>Kopiere den Schlüssel und füge ihn hier ein. Er gilt dann auf all deinen Geräten.</li>
      </ol>
      <form class="form" id="key-form" autocomplete="off">
        <div class="field wide"><label for="s-key">Gemini API-Schlüssel</label><input id="s-key" type="password" placeholder="${k?"Gespeichert – zum Ändern neu einfügen":"AIza…"}" spellcheck="false" autocapitalize="off"></div>
        <div class="field"><label for="s-model">Modell</label><input id="s-model" type="text" list="models" value="${esc(S.settings.model||DEFAULT_MODEL)}" spellcheck="false" autocapitalize="off">
          <datalist id="models"><option value="gemini-flash-latest"><option value="gemini-3.8-flash"><option value="gemini-3.5-flash-lite"></datalist></div>
        <div class="form-foot"><button class="btn" type="submit">Speichern</button><button class="btn ghost" type="button" data-global="test">Verbindung testen</button><span class="mono muted" id="test-state"></span></div>
      </form>
    </section>
    <section class="block">
      <div class="block-head"><h2>Erinnerungen</h2><span class="mono muted" id="push-state">${pushStatus()}</span></div>
      <p class="soon">Um 8, 11, 14, 17 und 20 Uhr bekommst du eine Mitteilung mit deinen offenen Aufgaben, solange etwas offen ist.${isIOS()&&!isStandalone()?" Auf dem iPhone geht das nur aus der App auf dem Home-Bildschirm: erst hinzufügen, dann dort aktivieren.":""}</p>
      <div class="form-foot" style="margin-top:16px">
        <button class="btn" data-global="push-on" ${pushSupported()?"":"disabled"}>Auf diesem Gerät aktivieren</button>
        <button class="link" data-global="push-off">Auf diesem Gerät ausschalten</button>
      </div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Auf deinen Geräten</h2></div>
      <ol class="steps">
        <li><b>iPhone:</b> Diese Seite in Safari öffnen, auf Teilen tippen, dann „Zum Home-Bildschirm“.</li>
        <li><b>Mac:</b> In Safari „Ablage“ → „Zum Dock hinzufügen“, oder in Chrome über das Installieren-Symbol in der Adresszeile.</li>
        <li>Mit derselben E-Mail anmelden. Aufgaben, Profil und Briefings gleichen sich automatisch ab.</li>
      </ol>
    </section>
    <section class="block">
      <div class="block-head"><h2>Konto</h2></div>
      <div class="form-foot" style="margin-top:20px"><button class="btn ghost" data-global="logout">Abmelden</button><button class="link" data-global="reset-config">Firebase-Verbindung zurücksetzen</button></div>
    </section>`;
}
function viewConfig(){
  return `<div class="gate">
    <div class="wordmark big">CPSLS<br>Tasker<small>Einmalige Einrichtung</small></div>
    <h1 class="hero sm">Verbinden</h1>
    <p class="soon">Deine Aufgaben werden in deinem eigenen, kostenlosen Firebase-Projekt gespeichert. So sind sie auf Mac und iPhone gleich.</p>
    <ol class="steps">
      <li>Öffne <a class="link" href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>, lege ein Projekt „cpsls-tasker“ an (Google Analytics aus).</li>
      <li>Unter <b>Authentication</b> → „Get started“ → <b>E-Mail/Passwort</b> aktivieren.</li>
      <li>Unter <b>Firestore Database</b> → „Create database“ (Standort europe-west3) und bei <b>Rules</b> die Regeln aus der Anleitung einfügen.</li>
      <li>Unter <b>Projekteinstellungen</b> → „Deine Apps“ → Web-App (&lt;/&gt;) registrieren und den Block <span class="mono">firebaseConfig</span> kopieren.</li>
    </ol>
    <form class="form" id="config-form" autocomplete="off">
      <div class="field wide"><label for="cfg">firebaseConfig hier einfügen</label><textarea id="cfg" rows="7" spellcheck="false" autocapitalize="off" placeholder='const firebaseConfig = { apiKey: "…", authDomain: "…", projectId: "…", … };'></textarea></div>
      <div class="form-foot"><button class="btn" type="submit">Verbinden</button></div>
    </form>
    ${S.authError?`<p class="notice">${esc(S.authError)}</p>`:""}
  </div>`;
}
function viewAuth(){
  return `<div class="gate">
    <div class="wordmark big">CPSLS<br>Tasker<small>Brand Operations</small></div>
    <h1 class="hero sm">Anmelden</h1>
    <form class="form one" id="auth-form" autocomplete="on">
      <div class="field wide"><label for="a-email">E-Mail</label><input id="a-email" type="email" autocomplete="username" autocapitalize="off" required></div>
      <div class="field wide"><label for="a-pass">Passwort</label><input id="a-pass" type="password" autocomplete="current-password" minlength="6" required></div>
      <div class="form-foot">
        <button class="btn" type="submit" data-mode="login" ${S.authBusy?"disabled":""}>Anmelden</button>
        <button class="btn ghost" type="submit" data-mode="signup" ${S.authBusy?"disabled":""}>Konto erstellen</button>
        <button class="link" type="button" data-global="reset-pass">Passwort vergessen</button>
      </div>
    </form>
    ${S.authError?`<p class="notice">${esc(S.authError)}</p>`:""}
    <p class="soon">Beim ersten Mal „Konto erstellen“, auf weiteren Geräten mit denselben Daten anmelden.</p>
  </div>`;
}
function isoWeek(d){ const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const n=t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-n); const y=new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil(((t-y)/864e5+1)/7); }

function render(){
  document.body.dataset.phase=S.phase;
  if(S.phase==="boot"){ $("#main").innerHTML=""; return; }
  if(S.phase==="config"){ if(!$("#config-form")||render.force) $("#main").innerHTML=viewConfig(); render.force=false; return; }
  if(S.phase==="auth"){
    const e=$("#a-email")&&$("#a-email").value, p=$("#a-pass")&&$("#a-pass").value;
    $("#main").innerHTML=viewAuth();
    if(e) $("#a-email").value=e; if(p) $("#a-pass").value=p;
    return;
  }
  const views={today:viewToday,all:viewAll,brand:viewBrand,techpack:viewTechpack,settings:viewSettings};
  if((S.view==="brand"||S.view==="settings") && render.keepForm) return updateCounts();
  const active=document.activeElement && document.activeElement.id;
  const draft=$("#new-title")?{t:$("#new-title").value,c:$("#new-cat").value,d:$("#new-due").value,p:$("#new-prio").checked}:null;
  $("#main").innerHTML=views[S.view]();
  if(draft && $("#new-title")){ $("#new-title").value=draft.t; $("#new-cat").value=draft.c; $("#new-due").value=draft.d; $("#new-prio").checked=draft.p; }
  if(active && document.getElementById(active)) document.getElementById(active).focus({preventScroll:true});
  document.querySelectorAll("#nav button").forEach(b=>b.setAttribute("aria-current", String(b.dataset.view===S.view)));
  updateCounts();
}
function updateCounts(){
  const t=today(), open=S.tasks.filter(x=>!x.done);
  $("#c-today").textContent=open.filter(x=>(x.due&&x.due<=t)||x.priority==="high").length||"";
  $("#c-all").textContent=open.length||"";
  $("#sync").textContent=!navigator.onLine?"Offline · gleicht später ab":S.settings.geminiKey?"Synchron · Gemini aktiv":"Synchron";
}
function go(view){ S.view=view; render.keepForm=false; render(); window.scrollTo(0,0); }

/* ---------- events ---------- */
let submitMode="login";
document.addEventListener("click", async e=>{
  const sm=e.target.closest("[data-mode]"); if(sm) submitMode=sm.dataset.mode;
  const nav=e.target.closest("#nav button"); if(nav) return go(nav.dataset.view);
  const g=e.target.closest("[data-go]"); if(g) return go(g.dataset.go);
  const ch=e.target.closest("[data-filter]"); if(ch){ S.filter=ch.dataset.filter; render(); return; }
  const br=e.target.closest("[data-brief]"); if(br){
    const a=br.dataset.brief;
    if(a==="gen") generateBrief(false); else if(a==="all") acceptAll(); else decide(br.dataset.item, a==="accept");
    return; }
  const gl=e.target.closest("[data-global]"); if(gl){
    const a=gl.dataset.global;
    if(a==="clear-done") removeTasks(S.tasks.filter(t=>t.done));
    if(a==="clear-examples") removeTasks(S.tasks.filter(t=>t.example));
    if(a==="logout") signOut(fb.auth);
    if(a==="push-on") enablePush();
    if(a==="push-off") disablePush();
    if(a==="reset-config"){ ls.del(CONFIG_KEY); location.reload(); }
    if(a==="reset-pass"){
      const email=$("#a-email").value.trim();
      if(!email){ S.authError="Trag zuerst deine E-Mail ein."; render(); return; }
      sendPasswordResetEmail(fb.auth,email).then(()=>{ S.authError="Wir haben dir einen Link zum Zurücksetzen geschickt."; render(); })
        .catch(()=>{ S.authError="Der Link konnte nicht gesendet werden. Prüfe die E-Mail-Adresse."; render(); });
    }
    if(a==="test"){
      const st=$("#test-state"), key=$("#s-key").value.trim()||S.settings.geminiKey, model=$("#s-model").value.trim()||DEFAULT_MODEL;
      if(!key){ st.textContent="Erst einen Schlüssel eintragen"; return; }
      st.textContent="Teste …";
      try{ await askGemini('Antworte nur mit {"ok":true}', model, key); st.textContent="Verbindung steht"; }
      catch(err){ st.textContent=errorText(err); }
    }
    return; }
  const act=e.target.closest("[data-act]"); if(act){
    const li=act.closest(".task"), id=li&&li.dataset.id, t=S.tasks.find(x=>x.id===id); if(!t) return;
    if(act.dataset.act==="toggle") patchTask(id,{done:!t.done,doneAt:!t.done?Date.now():0});
    if(act.dataset.act==="delete") removeTasks([t]);
    if(act.dataset.act==="expand"){ S.openIds.has(id)?S.openIds.delete(id):S.openIds.add(id); li.classList.toggle("open"); }
  }
});
document.addEventListener("submit", async e=>{
  e.preventDefault();
  const id=e.target.id;
  if(id==="config-form"){
    const cfg=parseConfig($("#cfg").value);
    if(!cfg){ S.authError="Das sieht nicht wie ein firebaseConfig-Block aus. Kopiere den ganzen Block mit apiKey, projectId und appId."; render.force=true; render(); return; }
    ls.set(CONFIG_KEY, JSON.stringify(cfg)); S.authError=""; S.phase="auth"; startFirebase(cfg); render();
  }
  if(id==="auth-form"){
    const email=$("#a-email").value.trim(), pass=$("#a-pass").value;
    S.authBusy=true; S.authError=""; render();
    try{
      if(submitMode==="signup") await createUserWithEmailAndPassword(fb.auth,email,pass);
      else await signInWithEmailAndPassword(fb.auth,email,pass);
    }catch(err){
      const c=err&&err.code||"";
      S.authError= c.includes("invalid-credential")||c.includes("wrong-password")||c.includes("user-not-found") ? "E-Mail oder Passwort stimmt nicht." :
                   c.includes("email-already-in-use") ? "Für diese E-Mail gibt es schon ein Konto. Melde dich an." :
                   c.includes("weak-password") ? "Das Passwort braucht mindestens 6 Zeichen." :
                   c.includes("operation-not-allowed") ? "E-Mail/Passwort ist in Firebase noch nicht aktiviert (Authentication → Sign-in method)." :
                   c.includes("network") ? "Keine Verbindung. Prüfe dein Internet." :
                   c.includes("api-key") ? "Der firebaseConfig-Block ist ungültig. Setze die Verbindung zurück und füge ihn neu ein." :
                   "Anmeldung fehlgeschlagen ("+c+").";
    }
    S.authBusy=false; if(S.phase==="auth") render();
  }
  if(id==="composer"){
    const title=$("#new-title").value.trim(); if(!title){ $("#new-title").focus(); return; }
    addTask({title, category:$("#new-cat").value, due:$("#new-due").value, priority:$("#new-prio").checked?"high":"normal"});
    $("#new-title").value=""; $("#new-prio").checked=false; toast("Hinzugefügt");
  }
  if(id==="brand-form"){
    const p={}; ["name","drop","positioning","audience","tone","channels","notes"].forEach(k=>p[k]=document.getElementById("b-"+k).value.trim());
    render.keepForm=false;
    setDoc(userRef(),{profile:p},{merge:true}).then(()=>toast("Profil gespeichert")).catch(fail);
  }
  if(id==="key-form"){
    const key=$("#s-key").value.trim(), model=$("#s-model").value.trim()||DEFAULT_MODEL;
    const settings={model}; if(key) settings.geminiKey=key;
    render.keepForm=false;
    setDoc(userRef(),{settings},{merge:true}).then(()=>{ toast("Gespeichert"); S.briefError=""; }).catch(fail);
  }
});
document.addEventListener("input", e=>{ if(e.target.closest("#brand-form,#key-form")) render.keepForm=true; });
const wake=()=>{ if(S.phase==="app"){ watchBrief(); render(); maybeAutoBrief(); } };
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) wake(); });
window.addEventListener("focus", wake);
window.addEventListener("online", ()=>{ updateCounts(); maybeAutoBrief(); });
window.addEventListener("offline", updateCounts);
setInterval(()=>{ if(S.phase==="app" && S.briefDay!==today()) wake(); }, 5*60*1000);

if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});

/* ---------- boot ---------- */
(function boot(){
  // Built-in connection to the cpsls-tasker Firebase project (public web config, protected by Firestore rules).
  const BUILTIN = {apiKey:"AIzaSyC66PhYds0IAIuwcHGq9RHM_n1pghjFaWM", authDomain:"cpsls-tasker.firebaseapp.com", projectId:"cpsls-tasker",
    storageBucket:"cpsls-tasker.firebasestorage.app", messagingSenderId:"225795379947", appId:"1:225795379947:web:8759fa854429cb87aca4ae"};
  let cfg=null; try{ cfg=JSON.parse(ls.get(CONFIG_KEY)||"null"); }catch(e){}
  cfg=cfg||BUILTIN;
  if(!cfg){ S.phase="config"; render(); return; }
  S.phase="auth"; startFirebase(cfg);
})();
