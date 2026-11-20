var ICONS={
 circle:'<circle cx="12" cy="12" r="9"/>',
 triangle:'<path d="M12 3 22 21H2z"/>',
 square:'<rect x="4" y="4" width="16" height="16" rx="2"/>',
 star:'<path d="m12 2 3 7 7 .6-5.3 4.8 1.6 7.2L12 17.8 5.7 21.6l1.6-7.2L2 9.6 9 9z"/>',
 hex:'<path d="M12 2 21 7v10l-9 5-9-5V7z"/>',
 diamond:'<path d="M12 2 22 12 12 22 2 12z"/>',
 cross:'<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>',
 moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 9 9 0 1 0 20 14.5z"/>'
};
var apps=[],token=sessionStorage.getItem("ui_tok")||"";
var CHUNK=700*1024, MAXSIZE=40*1024*1024;
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function size(n){return n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB"}
function b64(buf){var u=new Uint8Array(buf),s="";for(var i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)}

function render(){
 var q=document.getElementById("search").value.toLowerCase(),g=document.getElementById("grid"),h="";
 apps.filter(function(a){return (a.name+" "+a.desc).toLowerCase().indexOf(q)>-1}).forEach(function(a){
  h+='<div class="card"><h3>'+esc(a.name)+'</h3><p>'+esc(a.desc||"Portable app")+'</p><div class="meta">'+size(a.size)+' &middot; '+esc(a.file)+'</div>'
   +'<div class="row"><button class="btn" data-dl="'+esc(a.id)+'">Download</button></div></div>';
 });
 g.innerHTML=h||'<div class="empty">No apps here yet.</div>';
 Array.prototype.forEach.call(g.querySelectorAll("[data-dl]"),function(b){
  b.onclick=function(){var a=apps.find(function(x){return x.id===b.dataset.dl});if(a)download(a,b)};
 });

 var open=!!token;
 document.getElementById("admin").style.display=open?"block":"none";
 document.body.classList.toggle("locked",open);
 if(open){
  var ah="";
  apps.forEach(function(a){
   ah+='<div class="arow"><div><b>'+esc(a.name)+'</b><span class="meta">'+size(a.size)+' &middot; '+esc(a.file)+'</span></div>'
    +'<button class="btn red" data-del="'+esc(a.id)+'">Delete</button></div>';
  });
  var al=document.getElementById("adminapps");
  al.innerHTML=ah||'<div class="meta">No apps yet. Upload one above.</div>';
  Array.prototype.forEach.call(al.querySelectorAll("[data-del]"),function(b){
   b.onclick=function(){ if(!confirm("Delete this app?"))return; call("DELETE","/api/admin/app/"+encodeURIComponent(b.dataset.del)).then(load); };
  });
  loadInbox();
 }
}

async function download(a,btn){
 if(btn.disabled)return;
 btn.disabled=true;
 var parts=[];
 try{
  for(var i=0;i<a.chunks;i++){
   btn.textContent=Math.round(i/a.chunks*100)+"%";
   var r=await fetch("/api/chunk/"+encodeURIComponent(a.id)+"/"+i);
   if(!r.ok)throw new Error("fail");
   var bin=atob(await r.text()),u=new Uint8Array(bin.length);
   for(var j=0;j<bin.length;j++)u[j]=bin.charCodeAt(j);
   parts.push(u);
  }
  var url=URL.createObjectURL(new Blob(parts)),l=document.createElement("a");
  l.href=url;l.download=a.file;document.body.appendChild(l);l.click();l.remove();
  setTimeout(function(){URL.revokeObjectURL(url)},5000);
  btn.textContent="Download";
 }catch(e){btn.textContent="Failed, retry"}
 btn.disabled=false;
}

function loadInbox(){
 call("GET","/api/admin/messages").then(function(r){return r.ok?r.json():[]}).then(function(m){
  var h="";
  m.forEach(function(x){
   h+='<div class="msgi"><b>'+(x.kind==="request"?"App request":"Question")+'</b><div class="meta">'+new Date(x.created_at).toLocaleString()+(x.contact?" &middot; "+esc(x.contact):"")+'</div>'+esc(x.text)
    +'<div style="margin-top:6px"><button class="btn red" data-m="'+x.id+'">Delete</button></div></div>';
  });
  var l=document.getElementById("inboxlist");
  l.innerHTML=h||'<div class="meta">No messages yet.</div>';
  Array.prototype.forEach.call(l.querySelectorAll("[data-m]"),function(b){
   b.onclick=function(){call("DELETE","/api/admin/message/"+b.dataset.m).then(loadInbox)};
  });
 });
}
document.getElementById("qsend").onclick=function(){
 var t=document.getElementById("qtext").value.trim(),q=document.getElementById("qmsg");
 if(!t){q.textContent="Type something first.";return}
 fetch("/api/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
  kind:document.getElementById("qkind").value,text:t,contact:document.getElementById("qcontact").value.trim()})})
 .then(function(r){
  if(r.ok){q.textContent="Sent! The admin will see it.";document.getElementById("qtext").value="";}
  else q.textContent=r.status===429?"Too many messages, try again in a few minutes.":"Couldn't send.";
 }).catch(function(){q.textContent="Couldn't send."});
};
function call(method,url,body,headers){
 headers=headers||{}; if(token)headers["Authorization"]="Bearer "+token;
 return fetch(url,{method:method,body:body,headers:headers}).then(function(r){
  if(r.status===401){token="";sessionStorage.removeItem("ui_tok");render();}
  return r;
 });
}
function load(){ fetch("/api/apps").then(function(r){return r.json()}).then(function(d){apps=d;render();}); }
document.getElementById("search").oninput=render;

var names=Object.keys(ICONS).sort(function(){return Math.random()-.5});
var lg=document.getElementById("logos");
names.forEach(function(n){
 var b=document.createElement("button");b.setAttribute("aria-label","logo");
 b.innerHTML='<svg viewBox="0 0 24 24">'+ICONS[n]+'</svg>';
 b.onclick=function(){click(n)};
 lg.appendChild(b);
});

var seq=[],timer=null;
function click(n){
 seq.push(n); clearTimeout(timer);
 if(seq.length>12)seq=[];
 timer=setTimeout(function(){
  var s=seq.slice();seq=[];
  fetch("/api/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({seq:s})})
   .then(function(r){
    if(r.status>=500){alert("Server error ("+r.status+"). Check the secrets and the database tables.");return null}
    if(r.status===429){alert("Too many wrong tries. Wait 10 minutes.");return null}
    return r.ok?r.json():null;
   }).then(function(d){
    if(d&&d.token){token=d.token;sessionStorage.setItem("ui_tok",token);render();document.getElementById("admin").scrollTop=0;}
   }).catch(function(){alert("Couldn't reach the server.")});
 },1500);
}

document.getElementById("aout").onclick=function(){token="";sessionStorage.removeItem("ui_tok");render();};
document.getElementById("aup").onclick=async function(){
 var f=document.getElementById("afile").files[0],name=document.getElementById("aname").value.trim(),msg=document.getElementById("msg");
 var btn=document.getElementById("aup");
 if(!f||!name){msg.textContent="Pick a file and give it a name.";return;}
 if(f.size>MAXSIZE){msg.textContent="File too big (max 40 MB).";return;}
 btn.disabled=true;
 var id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 var total=Math.max(1,Math.ceil(f.size/CHUNK));
 try{
  for(var i=0;i<total;i++){
   msg.textContent="Uploading "+Math.round(i/total*100)+"%...";
   var buf=await f.slice(i*CHUNK,(i+1)*CHUNK).arrayBuffer();
   var r=await call("PUT","/api/admin/chunk/"+id+"/"+i,b64(buf),{"Content-Type":"text/plain"});
   if(!r.ok)throw new Error("chunk "+r.status);
  }
  var r2=await call("POST","/api/admin/finish",JSON.stringify({id:id,name:name,desc:document.getElementById("adesc").value.trim(),file:f.name,size:f.size}),{"Content-Type":"application/json"});
  if(!r2.ok)throw new Error("finish "+r2.status);
  msg.textContent="Added.";
  document.getElementById("afile").value="";document.getElementById("aname").value="";document.getElementById("adesc").value="";
  load();
 }catch(e){msg.textContent="Upload failed ("+e.message+"). Try again."}
 btn.disabled=false;
};
load();
