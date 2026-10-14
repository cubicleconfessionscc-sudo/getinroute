const TOKEN='I70bYCIHT-ac5vlqxboqQWA-1Tp3ataxGykQwJex6HC'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='mutation Connect($id: String!, $input: ServiceConnectInput!) { serviceConnect(id: $id, input: $input) { id name } }';
const variables={id:'0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5',input:{repo:'cubicleconfessionscc-sudo/getinroute',branch:'main'}};
const body=JSON.stringify({query:q,variables});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('HTTP',res.statusCode,d))});
req.on('error',e=>console.error('ERR',e.message)); req.write(body); req.end();
