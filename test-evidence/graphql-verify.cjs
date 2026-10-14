const TOKEN='I70bYCIHT-ac5vlqxboqQWA-1Tp3ataxGykQwJex6HC'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='{ serviceInstance(serviceId: "0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5", environmentId: "7e6c890a-b180-4b49-a42e-dd804ea39cac") { id rootDirectory dockerfilePath startCommand healthcheckPath healthcheckTimeout builder source { image repo } } }';
const body=JSON.stringify({query:q});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log(d))});
req.write(body); req.end();
