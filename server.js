import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=express();
const db=new Database('gamehub.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL COLLATE NOCASE,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('suggested','planned','played','rejected')),submitter_id TEXT,submitter_name TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(title));CREATE TABLE IF NOT EXISTS votes (game_id INTEGER NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(game_id,user_id),FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE);`);
db.pragma('foreign_keys = ON');
const base=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const clientId=process.env.TWITCH_CLIENT_ID;
const clientSecret=process.env.TWITCH_CLIENT_SECRET;
const adminId=process.env.ADMIN_TWITCH_ID;
const adminLogin=(process.env.ADMIN_TWITCH_LOGIN||'t3xaskobold').toLowerCase();
const production=process.env.NODE_ENV==='production';
if(production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32 || !clientId || !clientSecret || !base.startsWith('https://'))) throw Error('Production requires SESSION_SECRET (32+ characters), Twitch credentials and HTTPS BASE_URL');
app.set('trust proxy',production?1:false);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","https://static-cdn.jtvnw.net","data:"],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:production?[]:null}}}));
app.use(express.json({limit:'20kb'}));
app.use(session({name:'gamehub.sid',secret:process.env.SESSION_SECRET||'local-development-secret-change-before-deploying',resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:production,sameSite:'lax',maxAge:7*24*3600*1000}}));
app.use('/api',rateLimit({windowMs:60_000,limit:90,standardHeaders:'draft-7',legacyHeaders:false}));
const isAdmin=u=>!!u&&(adminId?u.id===adminId:u.login.toLowerCase()===adminLogin);
const auth=(req,res,next)=>req.session.user?next():res.status(401).json({error:'Bitte zuerst mit Twitch anmelden.'});
const admin=(req,res,next)=>isAdmin(req.session.user)?next():res.status(403).json({error:'Nur für den Admin.'});
const csrf=(req,res,next)=>req.get('x-csrf-token')===req.session.csrf?next():res.status(403).json({error:'Ungültiger Sicherheitstoken.'});
app.get('/auth/twitch',(req,res)=>{
 if(!clientId)return res.status(503).send('Twitch-Zugangsdaten fehlen. Bitte .env konfigurieren.');
 const state=crypto.randomBytes(24).toString('hex');req.session.oauthState=state;
 const p=new URLSearchParams({client_id:clientId,redirect_uri:base+'/auth/callback',response_type:'code',scope:'user:read:email',state});
 res.redirect('https://id.twitch.tv/oauth2/authorize?'+p);
});
app.get('/auth/callback',async(req,res)=>{
 const state=req.query.state;const code=req.query.code;
 if(typeof state!=='string'||typeof code!=='string'||!req.session.oauthState||state!==req.session.oauthState)return res.status(400).send('Ungültige Twitch-Anmeldung.');
 delete req.session.oauthState;
 try{
  const tokenResponse=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,grant_type:'authorization_code',redirect_uri:base+'/auth/callback'})});
  if(!tokenResponse.ok)throw Error('Token-Austausch fehlgeschlagen');
  const token=await tokenResponse.json();
  const userResponse=await fetch('https://api.twitch.tv/helix/users',{headers:{Authorization:'Bearer '+token.access_token,'Client-Id':clientId}});
  if(!userResponse.ok)throw Error('Twitch-Profil nicht abrufbar');
  const u=(await userResponse.json()).data?.[0];if(!u)throw Error('Kein Twitch-Profil');
  req.session.regenerate(err=>{if(err)return res.status(500).send('Session-Fehler');req.session.user={id:u.id,login:u.login,display_name:u.display_name,avatar:u.profile_image_url};req.session.csrf=crypto.randomBytes(24).toString('hex');req.session.save(()=>res.redirect('/'));});
 }catch(e){console.error(e);res.status(502).send('Twitch-Anmeldung fehlgeschlagen. Bitte erneut versuchen.');}
});
app.get('/api/me',(req,res)=>res.json({user:req.session.user||null,admin:isAdmin(req.session.user),csrf:req.session.csrf||null,configured:!!(clientId&&clientSecret)}));
app.post('/api/logout',auth,csrf,(req,res)=>req.session.destroy(()=>{res.clearCookie('gamehub.sid');res.json({ok:true});}));
app.get('/api/games',(req,res)=>{
 const allowed=isAdmin(req.session.user);
 const rows=db.prepare(`SELECT g.id,g.title,g.description,g.status,g.submitter_name,g.created_at,COUNT(v.user_id) AS votes FROM games g LEFT JOIN votes v ON v.game_id=g.id ${allowed?'':"WHERE g.status != 'rejected'"} GROUP BY g.id ORDER BY CASE g.status WHEN 'suggested' THEN 0 WHEN 'planned' THEN 1 WHEN 'played' THEN 2 ELSE 3 END, votes DESC,g.created_at DESC`).all();
 const myVotes=req.session.user?db.prepare('SELECT game_id FROM votes WHERE user_id=?').all(req.session.user.id).map(x=>x.game_id):[];
 res.json({games:rows,myVotes});
});
const validateTitle=title=>typeof title==='string'&&title.trim().length>=2&&title.trim().length<=100;
app.post('/api/games',auth,csrf,(req,res)=>{
 const {title,description=''}=req.body;
 if(!validateTitle(title)||typeof description!=='string'||description.length>500)return res.status(400).json({error:'Titel: 2–100 Zeichen, Beschreibung: maximal 500 Zeichen.'});
 const recent=db.prepare("SELECT COUNT(*) AS n FROM games WHERE submitter_id=? AND created_at > datetime('now','-1 day')").get(req.session.user.id).n;
 if(recent>=5&&!isAdmin(req.session.user))return res.status(429).json({error:'Maximal 5 Vorschläge pro Tag.'});
 try{const r=db.prepare('INSERT INTO games(title,description,status,submitter_id,submitter_name) VALUES(?,?,?,?,?)').run(title.trim(),description.trim(),isAdmin(req.session.user)&&req.body.status==='planned'?'planned':'suggested',req.session.user.id,req.session.user.display_name);res.status(201).json({id:r.lastInsertRowid});}
 catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'Dieses Spiel steht bereits auf der Liste.'});throw e;}
});
app.post('/api/games/:id/vote',auth,csrf,(req,res)=>{
 const game=db.prepare('SELECT id,status FROM games WHERE id=?').get(req.params.id);
 if(!game||game.status!=='suggested')return res.status(404).json({error:'Dieser Vorschlag ist nicht abstimmbar.'});
 const exists=db.prepare('SELECT 1 FROM votes WHERE game_id=? AND user_id=?').get(game.id,req.session.user.id);
 if(exists)db.prepare('DELETE FROM votes WHERE game_id=? AND user_id=?').run(game.id,req.session.user.id);
 else db.prepare('INSERT INTO votes(game_id,user_id) VALUES(?,?)').run(game.id,req.session.user.id);
 res.json({voted:!exists});
});
app.patch('/api/games/:id',auth,csrf,admin,(req,res)=>{
 const {status}=req.body;if(!['suggested','planned','played','rejected'].includes(status))return res.status(400).json({error:'Ungültiger Status.'});
 const r=db.prepare('UPDATE games SET status=? WHERE id=?').run(status,req.params.id);if(!r.changes)return res.status(404).json({error:'Spiel nicht gefunden.'});res.json({ok:true});
});
app.delete('/api/games/:id',auth,csrf,admin,(req,res)=>{const r=db.prepare('DELETE FROM games WHERE id=?').run(req.params.id);res.status(r.changes?200:404).json(r.changes?{ok:true}:{error:'Nicht gefunden.'});});
const root=path.dirname(fileURLToPath(import.meta.url));app.use(express.static(path.join(root,'public')));
app.listen(Number(process.env.PORT)||3000,()=>console.log('GameHub läuft auf Port '+(process.env.PORT||3000)));
