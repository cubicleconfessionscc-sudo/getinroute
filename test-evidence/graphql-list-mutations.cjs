const TOKEN='CXldevX4g31BhZRVzu-5j8DkBLevG1DXnejj_HRnJYM'; const ENDPOINT='https://backboard.railway.app/graphql/v2'; const https=require('https');
const q='{ __schema { mutationType { fields { name args { name type { name } } } } } }';
const body=JSON.stringify({query:q});
const req=https.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log(d))});
req.write(body); req.end();
