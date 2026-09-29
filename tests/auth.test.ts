import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { api, auth, login, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;

beforeAll(async () => {
  ids = await utentiDiPartenza();
});

describe('Accesso e registrazione', () => {
  it('login di trainer e clienti, email senza distinzione tra maiuscole e minuscole', async () => {
    const r = await login('ALESSIO@test.com');
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(r.body.passwordTemporanea).toBe(false);
  });

  it('password sbagliata → 401, senza dire se l’email esiste', async () => {
    const r = await login('felice@test.com', 'sbagliata');
    expect(r.status).toBe(401);
    const r2 = await login('nessuno@test.com', 'sbagliata');
    expect(r2.status).toBe(401);
    expect(r2.body).toEqual(r.body);
  });

  it('registrazione come TRAINER solo con il codice segreto', async () => {
    const senza = await api().post('/register').send({ nome: 'Hacker', email: 'h@x.com', password: 'password123', ruolo: 'TRAINER' });
    expect(senza.status).toBe(403);
    const sbagliato = await api()
      .post('/register')
      .send({ nome: 'Hacker', email: 'h@x.com', password: 'password123', ruolo: 'TRAINER', codiceTrainer: 'no' });
    expect(sbagliato.status).toBe(403);
    const giusto = await api()
      .post('/register')
      .send({ nome: 'Coach2', email: 'c2@x.com', password: 'password123', ruolo: 'TRAINER', codiceTrainer: 'codice-trainer-di-test' });
    expect(giusto.status).toBe(201);
  });

  it('email già registrata (anche con maiuscole diverse) rifiutata', async () => {
    const r = await api().post('/register').send({ nome: 'Doppio', email: 'Alessio@Test.com', password: 'password123' });
    expect(r.status).toBe(400);
  });

  it('senza token o con un token falso → 401', async () => {
    expect((await api().get('/schede')).status).toBe(401);
    expect((await api().get('/schede').set(auth('token-finto'))).status).toBe(401);
  });

  it('un token firmato con un’altra chiave non vale', async () => {
    const falso = jwt.sign({ userId: ids.trainer.id, ruolo: 'TRAINER', v: 0 }, 'chiave-sbagliata');
    expect((await api().get('/clienti').set(auth(falso))).status).toBe(401);
  });

  it('il ruolo si legge dal database, non dal token: un cliente non diventa trainer', async () => {
    const trucco = jwt.sign({ userId: ids.alessio.id, ruolo: 'TRAINER', v: 0 }, process.env.JWT_SECRET!);
    expect((await api().get('/clienti').set(auth(trucco))).status).toBe(403);
  });
});

describe('Il trainer gestisce gli accessi dei clienti', () => {
  it('/clienti è solo per il trainer e non mostra mai le password', async () => {
    const tF = await token('felice@test.com');
    const r = await api().get('/clienti').set(auth(tF));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r.body)).not.toContain('password"');
    const tA = await token('alessio@test.com');
    expect((await api().get('/clienti').set(auth(tA))).status).toBe(403);
  });

  it('reset della password: tutti i dispositivi del cliente vengono scollegati', async () => {
    const tF = await token('felice@test.com');
    const telefono = await token('alessio@test.com');
    const tablet = await token('alessio@test.com');

    expect((await api().put(`/clienti/${ids.alessio.id}/password`).set(auth(telefono)).send({ nuovaPassword: 'tempo-1234' })).status).toBe(403);
    expect((await api().put(`/clienti/${ids.trainer.id}/password`).set(auth(tF)).send({ nuovaPassword: 'tempo-1234' })).status).toBe(404);
    expect((await api().put(`/clienti/${ids.alessio.id}/password`).set(auth(tF)).send({ nuovaPassword: 'corta' })).status).toBe(400);

    const r = await api().put(`/clienti/${ids.alessio.id}/password`).set(auth(tF)).send({ nuovaPassword: 'kmtr-4827' });
    expect(r.status).toBe(204);
    expect((await api().get('/schede').set(auth(telefono))).status).toBe(401);
    expect((await api().get('/schede').set(auth(tablet))).status).toBe(401);
    expect((await login('alessio@test.com')).status).toBe(401);
  });

  it('con la password temporanea il cliente può solo sceglierne una nuova', async () => {
    const l = await login('alessio@test.com', 'kmtr-4827');
    expect(l.status).toBe(200);
    expect(l.body.passwordTemporanea).toBe(true);

    const bloccato = await api().get('/schede').set(auth(l.body.token));
    expect(bloccato.status).toBe(403);
    expect(bloccato.body.codice).toBe('CAMBIO_PASSWORD');

    const sbagliata = await api().put('/me/password').set(auth(l.body.token)).send({ passwordAttuale: 'no', nuovaPassword: 'alessio-nuova-99' });
    expect(sbagliata.status).toBe(400);
    const uguale = await api().put('/me/password').set(auth(l.body.token)).send({ passwordAttuale: 'kmtr-4827', nuovaPassword: 'kmtr-4827' });
    expect(uguale.status).toBe(400);

    const ok = await api().put('/me/password').set(auth(l.body.token)).send({ passwordAttuale: 'kmtr-4827', nuovaPassword: 'alessio-nuova-99' });
    expect(ok.status).toBe(200);
    expect((await api().get('/schede').set(auth(ok.body.token))).status).toBe(200);
    expect((await api().get('/schede').set(auth(l.body.token))).status).toBe(401);
    expect((await login('alessio@test.com', 'alessio-nuova-99')).body.passwordTemporanea).toBe(false);
  });

  it('cambio email del cliente: minuscole, niente doppioni, il telefono resta collegato', async () => {
    const tF = await token('felice@test.com');
    const tA = await token('alessio@test.com', 'alessio-nuova-99');
    expect((await api().put(`/clienti/${ids.alessio.id}/email`).set(auth(tF)).send({ email: 'giulia@test.com' })).status).toBe(409);
    expect((await api().put(`/clienti/${ids.alessio.id}/email`).set(auth(tF)).send({ email: 'non-una-email' })).status).toBe(400);

    const r = await api().put(`/clienti/${ids.alessio.id}/email`).set(auth(tF)).send({ email: '  Alessio.Rossi@Gmail.com ' });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe('alessio.rossi@gmail.com');
    expect(r.body).not.toHaveProperty('password');
    expect((await login('alessio.rossi@gmail.com', 'alessio-nuova-99')).status).toBe(200);
    expect((await api().get('/schede').set(auth(tA))).status).toBe(200);
    expect((await api().put(`/clienti/${ids.trainer.id}/email`).set(auth(tF)).send({ email: 'altro@test.com' })).status).toBe(404);
  });

  it('il trainer cambia la sua password: l’altro dispositivo esce, questo resta dentro', async () => {
    const pc = await token('felice@test.com');
    const telefono = await token('felice@test.com');
    const r = await api().put('/me/password').set(auth(pc)).send({ passwordAttuale: 'password123', nuovaPassword: 'felice-nuova-77' });
    expect(r.status).toBe(200);
    expect((await api().get('/clienti').set(auth(telefono))).status).toBe(401);
    expect((await api().get('/clienti').set(auth(r.body.token))).status).toBe(200);
  });
});

describe('Sessione che si rinnova da sola', () => {
  const firma = (dati: object, giorniFa: number) =>
    jwt.sign({ ...dati, iat: Math.floor(Date.now() / 1000) - giorniFa * 86400 }, process.env.JWT_SECRET!, { expiresIn: '30d' });

  it('un accesso appena fatto non viene rinnovato (non serve)', async () => {
    const r = await api().get('/schede').set(auth(await token('giulia@test.com')));
    expect(r.status).toBe(200);
    expect(r.headers['x-nuovo-token']).toBeUndefined();
  });

  it('un accesso di 20 giorni fa riceve un token nuovo, valido altri 30 giorni', async () => {
    const vecchio = firma({ userId: ids.giulia.id, ruolo: 'CLIENTE', v: 0 }, 20);
    const r = await api().get('/schede').set(auth(vecchio));
    expect(r.status).toBe(200);
    const nuovo = r.headers['x-nuovo-token'];
    expect(nuovo).toBeTruthy();
    const dati = jwt.decode(nuovo) as { exp: number; userId: number };
    expect(dati.userId).toBe(ids.giulia.id);
    expect(dati.exp - Date.now() / 1000).toBeGreaterThan(29 * 86400);
    expect((await api().get('/schede').set(auth(nuovo))).status).toBe(200);
  });

  it('il frontend (su un altro dominio) può leggere il token rinnovato', async () => {
    const r = await api().get('/health').set('Origin', 'https://esempio.it');
    expect(String(r.headers['access-control-expose-headers']).toLowerCase()).toContain('x-nuovo-token');
  });

  it('un accesso scaduto non si rinnova', async () => {
    const scaduto = jwt.sign(
      { userId: ids.giulia.id, ruolo: 'CLIENTE', v: 0, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
    );
    const r = await api().get('/schede').set(auth(scaduto));
    expect(r.status).toBe(401);
    expect(r.headers['x-nuovo-token']).toBeUndefined();
  });

  it('dopo un cambio password anche il token rinnovato smette di valere', async () => {
    const vecchio = firma({ userId: ids.giulia.id, ruolo: 'CLIENTE', v: 0 }, 5);
    const rinnovato = (await api().get('/schede').set(auth(vecchio))).headers['x-nuovo-token'];
    const tG = await token('giulia@test.com');
    await api().put('/me/password').set(auth(tG)).send({ passwordAttuale: 'password123', nuovaPassword: 'giulia-nuova-55' });
    expect((await api().get('/schede').set(auth(rinnovato))).status).toBe(401);
  });
});
