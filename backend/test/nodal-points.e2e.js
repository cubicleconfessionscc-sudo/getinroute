/* Company Address validation + tenant/location scope E2E. */
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9350 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-nodal-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (detail ? ' -> ' + JSON.stringify(detail) : '')); } }
async function request(method, route, { token, body } = {}) {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Nodal@123', 4);
  const a = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','A','a@nodal.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(a, a);
  const b = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','B','b@nodal.test','Company B',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(b, b);
  const stA = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(a,'Karnataka').lastInsertRowid);
  const cityA = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(a,stA,'Bangalore').lastInsertRowid);
  const locA1 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(a,stA,cityA,'Loc A1').lastInsertRowid);
  const locA2 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(a,stA,cityA,'Loc A2').lastInsertRowid);
  const stB = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(b,'Tamil Nadu').lastInsertRowid);
  const cityB = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(b,stB,'Chennai').lastInsertRowid);
  const locB = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(b,stB,cityB,'Loc B').lastInsertRowid);
  const scoped = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id) VALUES ('admin','A1','a1@nodal.test','A Loc1',?,1,'active','company',?,?)`).run(hash,a,locA1).lastInsertRowid);
  db.close();
  const server = spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',DB_PATH:DB_FILE,JWT_SECRET:'nodal_secret',SIMULATE_GPS:'0'},stdio:['ignore','pipe','pipe']});
  const sockets=[]; server.stdout.on('data',d=>sockets.push(d)); server.stderr.on('data',d=>sockets.push(d));
  try {
    let up=false; for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,500));try{if((await fetch(base+'/health')).ok){up=true;break;}}catch{}}
    if(!up) throw new Error('server did not start: '+sockets.join('').slice(-1000));
    const login=async(email)=>request('POST','/api/auth/login',{body:{email,password:'Nodal@123',app:'web'}});
    const ta=(await login('a@nodal.test')).json.token, tb=(await login('b@nodal.test')).json.token, ts=(await login('a1@nodal.test')).json.token;
    const baseBody={label:'Head Office',address:'1600 Amphitheatre Parkway, Mountain View, CA',lat:37.422,lng:-122.084,place_id:'ChIJ2eUgeAK6j4ARbn5u_wAGqWA',radiusMeters:1000,company_location_id:locA1};
    const create=await request('POST','/api/company/me/nodal-points',{token:ta,body:baseBody});
    check('valid Google location saves with place_id',create.status===200&&create.json.place_id===baseBody.place_id,create);
    const listA=await request('GET','/api/company/me/nodal-points',{token:ta});
    check('Company A sees its address point',listA.status===200&&listA.json.length===1,listA);
    const listB=await request('GET','/api/company/me/nodal-points',{token:tb});
    check('Company B cannot see Company A address point',listB.status===200&&listB.json.length===0,listB);
    const badLat=await request('POST','/api/company/me/nodal-points',{token:ta,body:{...baseBody,lat:91}});
    check('latitude out of range rejected',badLat.status===400,badLat);
    const badLng=await request('POST','/api/company/me/nodal-points',{token:ta,body:{...baseBody,lng:181}});
    check('longitude out of range rejected',badLng.status===400,badLng);
    const badRadius=await request('POST','/api/company/me/nodal-points',{token:ta,body:{...baseBody,radiusMeters:0}});
    check('invalid radius rejected',badRadius.status===400,badRadius);
    const cross=await request('POST','/api/company/me/nodal-points',{token:ta,body:{...baseBody,company_location_id:locB}});
    check('cross-company location id rejected',cross.status===403,cross);
    const crossLoc=await request('POST','/api/company/me/nodal-points',{token:ts,body:{...baseBody,company_location_id:locA2}});
    check('location-scoped admin cannot create for another location',crossLoc.status===403,crossLoc);
  } finally { server.kill(); await new Promise(r=>setTimeout(r,300)); for(const s of ['','-wal','-shm'])try{fs.unlinkSync(DB_FILE+s)}catch{} }
  console.log(`\nNODAL POINTS E2E: ${passed} passed, ${failed} failed`); process.exitCode=failed?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
