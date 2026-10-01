const mysql=require("mysql2/promise");const fs=require("fs");const env={};
fs.readFileSync(".env","utf8").split(/\r?\n/).forEach(l=>{const m=l.match(/^\s*([^#][^=]*)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim();});
(async()=>{const c=await mysql.createConnection({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
const [r]=await c.query("SELECT id,profile_picture,profile_picture_public_id FROM users WHERE id=76");console.table(r);await c.end();})();
