const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^(DATABASE_URL|DIRECT_URL)=(.*)$/);
  if (m) {
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    try {
      const u = new URL(val);
      console.log(key, {
        protocol: u.protocol,
        port: u.port,
        pathname: u.pathname,
        searchParams: u.searchParams.toString(),
        isPoolerHost: u.hostname.includes('pooler'),
      });
    } catch (e) {
      console.log(key, 'invalid URL');
    }
  }
}
