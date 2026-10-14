const TOKEN='I70bYCIHT-ac5vlqxboqQWA-1Tp3ataxGykQwJex6HC'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='{ deploymentLogs(deploymentId: "7dec6dba-d9f3-4561-bb25-be9b98e43149") { message severity timestamp attributes { key value } tags { deploymentId } } }';
const body=JSON.stringify({query:q});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log(d))});
req.write(body); req.end();
