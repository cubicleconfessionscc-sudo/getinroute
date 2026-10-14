const TOKEN='I70bYCIHT-ac5vlqxboqQWA-1Tp3ataxGykQwJex6HC'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='{ project(id: "df871066-14b2-4fbc-b218-1782d72063be") { id name githubInstallation { id account { login type } } } }';
const body=JSON.stringify({query:q});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log(d))});
req.write(body); req.end();
