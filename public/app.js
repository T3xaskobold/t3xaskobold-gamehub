import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db, user = null, admin = false;
function notice(message) { $('notice').textContent = message; $('notice').style.display = 'block'; clearTimeout(window.noticeTimer); window.noticeTimer = setTimeout(() => $('notice').style.display = 'none', 5000); }
function check({error}) { if (error) throw error; }
function empty() { return '<div class="empty">Hier ist noch Platz für neue Abenteuer 🎮</div>'; }
function card(g, type, counts, voted) {
 const n = counts.get(g.id) || 0;
 return `<article class="game"><div class="eyebrow">${type === 'suggested' ? 'SPIELVORSCHLAG' : type === 'planned' ? 'DEMNÄCHST' : 'GESPIELT'}</div><h3>${esc(g.title)}</h3>${g.description ? `<p>${esc(g.description)}</p>` : ''}${type === 'suggested' ? `<button class="vote ${voted.has(g.id) ? 'active' : ''}" data-vote="${g.id}">💜 ${n} ${voted.has(g.id) ? 'Abgestimmt' : 'Stimmen'}</button>` : ''}</article>`;
}
async function login() { const {error} = await db.auth.signInWithOAuth({provider:'twitch',options:{redirectTo:window.location.origin + window.location.pathname}}); check({error}); }
async function refreshAuth() {
 const {data:{user:u},error} = await db.auth.getUser(); if (error && error.name !== 'AuthSessionMissingError') throw error;
 user = u || null;
 admin = false;
 if (user) { const result = await db.rpc('is_gamehub_admin'); check(result); admin = result.data === true; }
 $('account').replaceChildren();
 if (user) { const name = document.createElement('span'); name.textContent = '👾 ' + (user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Twitch-User') + ' ';
 const btn = document.createElement('button'); btn.className='secondary'; btn.textContent='Logout'; btn.onclick = async () => { try { check(await db.auth.signOut()); await refreshAuth(); await load(); } catch(e) {notice(e.message);} }; $('account').append(name,btn); }
 else { const btn = document.createElement('button'); btn.className='primary'; btn.textContent='Mit Twitch anmelden'; btn.onclick=()=>login().catch(e=>notice(e.message)); $('account').append(btn); }
 $('adminSection').classList.toggle('hidden', !admin);
}
async function load() {
 const [gr,sr] = await Promise.all([db.from('games').select('id,title,description,status').order('created_at',{ascending:false}),db.from('suggestions').select('id,title,description,status,user_id').order('created_at',{ascending:false})]); check(gr); check(sr);
 const games = gr.data || [], suggestions = sr.data || [];
 const approved = suggestions.filter(s=>s.status==='approved');
 const ids = approved.map(s=>s.id);
 let votes=[];
 if (ids.length) { const vr = await db.from('votes').select('suggestion_id,user_id').in('suggestion_id',ids); check(vr); votes = vr.data || []; }
 const counts = new Map(), voted = new Set(); for (const v of votes) { counts.set(v.suggestion_id,(counts.get(v.suggestion_id)||0)+1); if (user && v.user_id===user.id) voted.add(v.suggestion_id); }
 const planned = games.filter(g=>g.status==='planned' || g.status==='playing'), played = games.filter(g=>g.status==='played');
 for (const [id,items,type] of [['suggested',approved,'suggested'],['planned',planned,'planned'],['played',played,'played']]) { $(id+'Count').textContent=items.length; $(id).innerHTML=items.length ? items.map(g=>card(g,type,counts,voted)).join('') : empty(); }
 document.querySelectorAll('[data-vote]').forEach(b=>b.onclick=async()=>{ if(!user) {notice('Bitte zuerst mit Twitch anmelden.');return;} const id=Number(b.dataset.vote); try { if(voted.has(id)) check(await db.from('votes').delete().eq('suggestion_id',id).eq('user_id',user.id)); else check(await db.from('votes').insert({suggestion_id:id,user_id:user.id})); await load(); } catch(e) {notice(e.message);} });
 if(admin) {
  $('adminSuggestions').innerHTML=suggestions.length?suggestions.map(s=>`<div class="adminrow"><span><b>${esc(s.title)}</b> <small>(${esc(s.status)})</small></span><div><button data-suggestion="${s.id}" data-sstatus="approved">Freigeben</button><button data-suggestion="${s.id}" data-sstatus="rejected">Ablehnen</button><button data-suggestion="${s.id}" data-sstatus="pending">Zurückstellen</button><button class="danger" data-sdelete="${s.id}">Löschen</button></div></div>`).join(''):empty();
  $('adminGames').innerHTML=games.length?games.map(g=>`<div class="adminrow"><span><b>${esc(g.title)}</b> <small>(${esc(g.status)})</small></span><div><button data-game="${g.id}" data-gstatus="planned">Planen</button><button data-game="${g.id}" data-gstatus="playing">Spiele ich</button><button data-game="${g.id}" data-gstatus="played">Gespielt</button><button class="danger" data-gdelete="${g.id}">Löschen</button></div></div>`).join(''):empty();
  document.querySelectorAll('[data-sstatus]').forEach(b=>b.onclick=async()=>{try{check(await db.from('suggestions').update({status:b.dataset.sstatus}).eq('id',Number(b.dataset.suggestion)));await load();}catch(e){notice(e.message)}});
  document.querySelectorAll('[data-sdelete]').forEach(b=>b.onclick=async()=>{if(!confirm('Vorschlag wirklich löschen?'))return;try{check(await db.from('suggestions').delete().eq('id',Number(b.dataset.sdelete)));await load();}catch(e){notice(e.message)}});
  document.querySelectorAll('[data-gstatus]').forEach(b=>b.onclick=async()=>{try{check(await db.from('games').update({status:b.dataset.gstatus}).eq('id',Number(b.dataset.game)));await load();}catch(e){notice(e.message)}});
  document.querySelectorAll('[data-gdelete]').forEach(b=>b.onclick=async()=>{if(!confirm('Spiel wirklich löschen?'))return;try{check(await db.from('games').delete().eq('id',Number(b.dataset.gdelete)));await load();}catch(e){notice(e.message)}});
 }
}
$('suggestForm').addEventListener('submit',async e=>{e.preventDefault();if(!user){notice('Bitte zuerst mit Twitch anmelden.');return;}try{check(await db.from('suggestions').insert({title:$('title').value.trim(),description:$('description').value.trim(),user_id:user.id}));e.target.reset();notice('Dein Vorschlag wartet auf Freigabe! 💜');await load();}catch(err){notice(err.message)}});
$('gameForm').addEventListener('submit',async e=>{e.preventDefault();if(!admin)return;try{check(await db.from('games').insert({title:$('gameTitle').value.trim(),description:$('gameDescription').value.trim(),status:$('gameStatus').value}));e.target.reset();notice('Spiel hinzugefügt!');await load();}catch(err){notice(err.message)}});
(async()=>{if(SUPABASE_PUBLISHABLE_KEY.startsWith('HIER_')){notice('Bitte zuerst den Publishable Key in public/config.js eintragen.');$('account').textContent='Konfiguration fehlt';return;}try{db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);await refreshAuth();await load();db.auth.onAuthStateChange(()=>{setTimeout(async()=>{try{await refreshAuth();await load();}catch(e){notice(e.message)}},0)});}catch(e){notice(e.message)}})();
