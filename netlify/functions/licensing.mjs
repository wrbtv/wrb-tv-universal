import { getStore } from "@netlify/blobs";

const STORE="wrb-tv-device-licenses";
const PREFIX="devices/";
const ID_RE=/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
const cors={"access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"Content-Type, Authorization","cache-control":"no-store"};
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"content-type":"application/json; charset=utf-8",...cors}});
const key=id=>PREFIX+id.toUpperCase();
const admin=req=>{const e=String(process.env.LICENSE_ADMIN_TOKEN||"");return !!e&&String(req.headers.get("authorization")||"")==="Bearer "+e};
const store=()=>getStore(STORE);
async function read(id){return store().get(key(id),{type:"json"});}
async function write(d){await store().set(key(d.device_id),d);return d;}

export default async req=>{
 if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST") return json({error:"Método não permitido."},405);
 let b={}; try{b=await req.json();}catch{return json({error:"JSON inválido."},400);}
 const action=String(b.action||"check"), id=String(b.device_id||"").trim().toUpperCase();
 if(!ID_RE.test(id)) return json({authorized:false,status:"invalid",error:"device_id inválido."},400);

 if(action==="check"){
   let d=await read(id);
   const now=new Date().toISOString();
   if(!d)d={device_id:id,app_id:String(b.app_id||"wrbtv-player"),app_version:String(b.app_version||"unknown"),platform:String(b.platform||"unknown"),username:"",customer_id:null,status:"inactive",authorized:false,created_at:now};
   if(b.app_id)d.app_id=String(b.app_id); if(b.app_version)d.app_version=String(b.app_version); if(b.platform)d.platform=String(b.platform);
   d.last_seen=now; await write(d);
   return json({authorized:d.status==="active",status:d.status,device_id:d.device_id,app_id:d.app_id,app_version:d.app_version,platform:d.platform,username:d.username||null,customer_id:d.customer_id,last_seen:d.last_seen,message:d.status==="active"?"Dispositivo autorizado.":"Para realizar a ativação, entre em contato com seu fornecedor."},d.status==="active"?200:403);
 }
 if(!admin(req)) return json({error:"Não autorizado."},401);
 if(["activate","deactivate"].includes(action)){
   let d=await read(id); const now=new Date().toISOString();
   if(!d)d={device_id:id,app_id:String(b.app_id||"wrbtv-player"),app_version:String(b.app_version||"unknown"),platform:String(b.platform||"unknown"),username:String(b.username||""),customer_id:b.customer_id??null,created_at:now};
   if(b.username!==undefined)d.username=String(b.username||""); if(b.customer_id!==undefined)d.customer_id=b.customer_id;
   d.status=action==="activate"?"active":"inactive";d.authorized=d.status==="active";d.updated_at=now;await write(d);
   return json({success:true,device_id:id,status:d.status,authorized:d.authorized});
 }
 if(action==="get"){const d=await read(id);return d?json(d):json({error:"Dispositivo não encontrado."},404);}
 return json({error:"Ação inválida."},400);
};
