// Messaggi del server in inglese per chi usa l'app in inglese ("Accept-Language: en").
// Senza intestazione, o con "it", tutto resta in italiano come prima.
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { INGLESE, traduci } from '../src/traduzioni';
import { api, auth, token, utentiDiPartenza } from './aiuti';

// Tutti i testi tra virgolette del codice del server che sembrano messaggi per l'utente
// (iniziano con la maiuscola e hanno più parole). I commenti non contano.
function messaggiNelCodice(): string[] {
  const file = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? file(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : [],
    );
  const trovati = new Set<string>();
  for (const f of file(path.join(__dirname, '../src'))) {
    if (f.endsWith('traduzioni.ts')) continue;
    const codice = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .map((riga) => riga.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
      .join('\n');
    for (const m of codice.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      const s = m[1] ?? m[2];
      if (/^[A-ZÀ-Ù]/.test(s) && /\s/.test(s) && /[a-zàèéìòù]{2,}/.test(s) && !/^(GET|PUT|POST|DELETE|PATCH) \//.test(s)) {
        trovati.add(s);
      }
    }
  }
  return [...trovati];
}

describe('Traduzioni dei messaggi', () => {
  it('ogni messaggio scritto nel codice ha la sua traduzione inglese', () => {
    const senza = messaggiNelCodice().filter((m) => !INGLESE[m]);
    expect(senza).toEqual([]);
  });

  it('nessuna traduzione è rimasta uguale all’italiano o vuota', () => {
    for (const [it, en] of Object.entries(INGLESE)) {
      expect(en.trim()).not.toBe('');
      expect(en).not.toBe(it);
    }
  });

  it('traduce anche il messaggio con il numero di clienti collegati', () => {
    const uno = "Hai ancora 1 cliente collegato: scrivi all'amministratore dell'app per chiudere o trasferire i loro account, poi potrai eliminare il tuo.";
    const tre = "Hai ancora 3 clienti collegati: scrivi all'amministratore dell'app per chiudere o trasferire i loro account, poi potrai eliminare il tuo.";
    expect(traduci(uno, 'en')).toMatch(/^You still have 1 linked client:/);
    expect(traduci(tre, 'en')).toMatch(/^You still have 3 linked clients:/);
    expect(traduci(tre, 'it')).toBe(tre);
  });
});

describe('Risposte nella lingua dell’app', () => {
  let tF: string;
  beforeEach(async () => {
    await utentiDiPartenza();
    tF = await token('felice@test.com');
  });

  it('login sbagliato: in inglese con Accept-Language en, in italiano senza', async () => {
    const corpo = { email: 'felice@test.com', password: 'sbagliata' };
    const en = await api().post('/login').set('Accept-Language', 'en').send(corpo);
    expect(en.status).toBe(401);
    expect(en.body.errore).toBe('Invalid email or password');
    const it = await api().post('/login').send(corpo);
    expect(it.body.errore).toBe('Credenziali non valide');
    const itEsplicito = await api().post('/login').set('Accept-Language', 'it').send(corpo);
    expect(itEsplicito.body.errore).toBe('Credenziali non valide');
  });

  it('traduce anche i messaggi della validazione (elenco "errori")', async () => {
    const r = await api()
      .post('/register')
      .set('Accept-Language', 'en')
      .send({ nome: 'A', email: 'nuovo@test.com', password: 'password123', ruolo: 'CLIENTE' });
    expect(r.status).toBe(400);
    expect(r.body.errori.map((e: { message: string }) => e.message)).toContain('The name must be at least 2 characters');
  });

  it('JSON malformato: anche quel messaggio arriva in inglese', async () => {
    const r = await api().post('/login').set('Accept-Language', 'en').set('Content-Type', 'application/json').send('{rotto');
    expect(r.status).toBe(400);
    expect(r.body.errore).toBe('Invalid request data');
  });

  it('le risposte con i dati non cambiano', async () => {
    const it = await api().get('/me').set(auth(tF));
    const en = await api().get('/me').set(auth(tF)).set('Accept-Language', 'en');
    expect(en.body).toEqual(it.body);
  });
});
