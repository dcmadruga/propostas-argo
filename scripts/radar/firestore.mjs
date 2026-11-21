// Firestore pela API REST com a conta de serviço (segredo FIREBASE_SERVICE_ACCOUNT no GitHub Actions).
// Sem dependências: o token OAuth é assinado aqui mesmo (JWT RS256). Sem o segredo, firestore() devolve null
// e o robô roda em modo de teste, sem gravar nada.
import { createSign } from 'node:crypto';

const enc = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
};
const dec = v => {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
};
const decFields = f => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, dec(x)]));

export function firestore() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) return null;
  const sa = JSON.parse(bruto);
  const projeto = process.env.FIREBASE_PROJECT || sa.project_id;
  const base = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents`;
  let token = null, vence = 0;
  async function auth() {
    if (token && Date.now() < vence - 60000) return token;
    const agora = Math.floor(Date.now() / 1000);
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const corpo = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 });
    const ass = createSign('RSA-SHA256').update(corpo).sign(sa.private_key, 'base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${corpo}.${ass}` });
    const j = await r.json();
    if (!j.access_token) throw new Error('Firebase: a chave de serviço foi recusada (' + (j.error_description || j.error || r.status) + ')');
    token = j.access_token; vence = Date.now() + j.expires_in * 1000;
    return token;
  }
  async function req(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, headers: { authorization: 'Bearer ' + await auth(), 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status === 404 && metodo === 'GET') return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Firestore ${metodo} ${r.status}: ${j.error?.message || ''}`);
    return j;
  }
  const nome = caminho => `projects/${projeto}/databases/(default)/documents/${caminho}`;
  return {
    async get(caminho) { const j = await req('GET', `${base}/${caminho}`); return j ? decFields(j.fields || {}) : null; },
    async lista(colecao) { // documentos inteiros de uma coleção (as do radar são pequenas)
      const out = []; let page = '';
      do { const j = await req('GET', `${base}/${colecao}?pageSize=300${page ? '&pageToken=' + page : ''}`); (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...decFields(d.fields || {}) })); page = j.nextPageToken || ''; } while (page);
      return out;
    },
    // grava em lotes de até 400: cada item {caminho, dados, mesclar} (mesclar = só os campos enviados)
    async gravar(itens) {
      for (let i = 0; i < itens.length; i += 400) {
        const writes = itens.slice(i, i + 400).map(({ caminho, dados, mesclar }) => {
          const w = { update: { name: nome(caminho), fields: enc(dados).mapValue.fields } };
          if (mesclar) w.updateMask = { fieldPaths: Object.keys(dados).map(k => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(k) ? k : '`' + k + '`') };
          return w;
        });
        await req('POST', `${base}:commit`, { writes });
      }
    }
  };
}
