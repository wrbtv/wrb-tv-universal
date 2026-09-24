import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Hls from 'hls.js';
import './style.css';

const PROVIDERS={
 '0022':{name:'Genial Play',base:'http://rekgol.top'},
 'PFAST':{name:'FAST',base:'http://p1fast.com'},
};
const demoGroups=['Todos','Canais ao Vivo','Filmes','Séries','Favoritos'];
function App(){
 const [logged,setLogged]=useState(()=>localStorage.getItem('wrb-auth')==='1');
 const [code,setCode]=useState(''); const [user,setUser]=useState(''); const [pass,setPass]=useState('');
 const [items,setItems]=useState([]); const [active,setActive]=useState('Todos'); const [q,setQ]=useState('');
 const [current,setCurrent]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
 const video=useRef(null); const hls=useRef(null);
 const provider=PROVIDERS[code.toUpperCase()];
 async function login(){
  setError(''); const c=code.trim().toUpperCase(); if(!PROVIDERS[c]){setError('Código de provedor não reconhecido.');return}
  if(!user||!pass){setError('Informe usuário e senha.');return}
  setLoading(true);
  try{
   const base=PROVIDERS[c].base.replace(/\/$/,'');
   const url=`${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
   const r=await fetch(url); if(!r.ok) throw new Error(`HTTP ${r.status}`); const data=await r.json();
   if(data.user_info?.auth===0) throw new Error('Usuário ou senha recusados pelo provedor.');
   const all=[];
   for(const type of ['live','movie','series']){
    const action=type==='live'?'get_live_streams':type==='movie'?'get_vod_streams':'get_series';
    try{const rr=await fetch(`${url}&action=${action}`); if(rr.ok){const arr=await rr.json(); if(Array.isArray(arr)) arr.slice(0,2000).forEach(x=>all.push({...x,_type:type,_base:base,_user:user,_pass:pass}));}}catch{}
   }
   localStorage.setItem('wrb-auth','1'); localStorage.setItem('wrb-config',JSON.stringify({c,user,pass})); setLogged(true); setItems(all); setError(all.length?'':'Conectado, mas o provedor não retornou a lista no navegador.');
  }catch(e){setError(`Não foi possível conectar: ${e.message}. Se o provedor bloquear CORS/HTTP no navegador, use o aplicativo Android/Windows.`)} finally{setLoading(false)}
 }
 function play(x){setError(''); setCurrent(x)}
 useEffect(()=>{ if(!current||!video.current)return; const v=video.current; const url=current._type==='live'?`${current._base}/live/${current._user}/${current._pass}/${current.stream_id}.m3u8`:`${current._base}/${current._type==='movie'?'movie':'series'}/${current._user}/${current._pass}/${current.stream_id}.m3u8`; if(hls.current){hls.current.destroy();hls.current=null} if(v.canPlayType('application/vnd.apple.mpegurl')) v.src=url; else if(Hls.isSupported()){const h=new Hls({enableWorker:true});h.loadSource(url);h.attachMedia(v);hls.current=h}else setError('Este navegador não suporta HLS.'); return()=>{if(hls.current){hls.current.destroy();hls.current=null}}},[current]);
 const filtered=useMemo(()=>items.filter(x=>(active==='Todos'||active==='Favoritos'||(active==='Canais ao Vivo'&&x._type==='live')||(active==='Filmes'&&x._type==='movie')||(active==='Séries'&&x._type==='series')) && (`${x.name||''}`.toLowerCase().includes(q.toLowerCase()))),[items,active,q]);
 if(!logged)return <div className="login"><img src="/logo.png"/><div className="card"><h1>Entrar</h1><p>Conecte sua conta IPTV</p><input placeholder="Código do provedor" value={code} onChange={e=>setCode(e.target.value)}/><input placeholder="Usuário" value={user} onChange={e=>setUser(e.target.value)}/><input placeholder="Senha" type="password" value={pass} onChange={e=>setPass(e.target.value)}/><button onClick={login} disabled={loading}>{loading?'CONECTANDO...':'ENTRAR'}</button>{provider&&<small>Provedor detectado: {provider.name}</small>}{error&&<div className="err">{error}</div>}</div></div>;
 return <div className="app"><aside><img className="sideLogo" src="/logo.png"/><nav>{demoGroups.map(g=><button className={active===g?'on':''} onClick={()=>setActive(g)} key={g}>{g}</button>)}</nav><button className="logout" onClick={()=>{localStorage.removeItem('wrb-auth');location.reload()}}>Sair</button></aside><main><header><div><h2>{active}</h2><span>WRB-TV</span></div><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar..."/></header>{error&&<div className="toperr">{error}</div>}<section className="grid">{filtered.map((x,i)=><button className="tile" key={x.stream_id||i} onClick={()=>play(x)}><div className="thumb">{x.stream_icon?<img src={x.stream_icon} onError={e=>e.currentTarget.style.display='none'}/>:<b>WRB-TV</b>}</div><strong>{x.name||'Sem nome'}</strong></button>)}</section>{!filtered.length&&<div className="empty">Nenhum conteúdo carregado.</div>}</main>{current&&<div className="player"><button className="close" onClick={()=>setCurrent(null)}>×</button><video ref={video} controls autoPlay playsInline/><h3>{current.name}</h3></div>}</div>}
createRoot(document.getElementById('root')).render(<App/>);
