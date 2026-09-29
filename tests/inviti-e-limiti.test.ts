import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, login, prisma, token, utentiDiPartenza } from './aiuti';

let tF: string;
let tA: string;

beforeAll(async () => {
  await utentiDiPartenza();
  tF = await token('felice@test.com');
  tA = await token('alessio@test.com');
});

afterEach(() => {
  delete process.env.INVITI_OBBLIGATORI;
});

const registra = (dati: object, ip = '10.50.0.1') =>
  api()
    .post('/register')
    .set('X-Forwarded-For', ip)
    .send({ password: 'password123', ruolo: 'CLIENTE', ...dati });

describe('Inviti monouso', () => {
  it('solo il trainer crea inviti, con un codice leggibile e la scadenza chiesta', async () => {
    expect((await api().post('/inviti').set(auth(tA)).send({})).status).toBe(403);
    const r = await api().post('/inviti').set(auth(tF)).send({ nota: 'Marco Rossi', giorni: 7 });
    expect(r.status).toBe(201);
    // 8 caratteri senza lettere/cifre che si confondono (0/O, 1/I/L)
    expect(r.body.codice).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(r.body.stato).toBe('attivo');
    const giorni = (new Date(r.body.scadeIl).getTime() - Date.now()) / 86_400_000;
    expect(giorni).toBeGreaterThan(6.9);
    expect(giorni).toBeLessThan(7.1);
  });

  it('il codice vale una volta sola (anche scritto minuscolo e con uno spazio)', async () => {
    const inv = (await api().post('/inviti').set(auth(tF)).send({ nota: 'Marco' })).body;
    const primo = await registra({ nome: 'Marco', email: 'marco@test.com', codiceInvito: inv.codice.toLowerCase().replace('-', ' ') });
    expect(primo.status).toBe(201);

    const secondo = await registra({ nome: 'Furbo', email: 'furbo@test.com', codiceInvito: inv.codice });
    expect(secondo.status).toBe(400);
    expect(secondo.body.errore).toContain('già usato');
    expect(await prisma.user.count({ where: { email: 'furbo@test.com' } })).toBe(0);

    const elenco = (await api().get('/inviti').set(auth(tF))).body;
    const usato = elenco.find((i: { id: number }) => i.id === inv.id);
    expect(usato.stato).toBe('usato');
    expect(usato.usatoDa.nome).toBe('Marco');
    expect(usato.usatoDa).not.toHaveProperty('password');
  });

  it('due persone con lo stesso codice nello stesso istante: entra solo una', async () => {
    const inv = (await api().post('/inviti').set(auth(tF)).send({})).body;
    const [a, b] = await Promise.all([
      registra({ nome: 'Uno', email: 'uno@test.com', codiceInvito: inv.codice }, '10.50.0.2'),
      registra({ nome: 'Due', email: 'due@test.com', codiceInvito: inv.codice }, '10.50.0.3'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await prisma.user.count({ where: { email: { in: ['uno@test.com', 'due@test.com'] } } })).toBe(1);
  });

  it('codici inventati, scaduti o annullati non funzionano', async () => {
    expect((await registra({ nome: 'X', email: 'x@test.com', codiceInvito: 'AAAA-BBBB' })).status).toBe(400);

    const scaduto = (await api().post('/inviti').set(auth(tF)).send({ giorni: 1 })).body;
    await prisma.invito.update({ where: { id: scaduto.id }, data: { scadeIl: new Date(Date.now() - 60_000) } });
    expect((await registra({ nome: 'Y', email: 'y@test.com', codiceInvito: scaduto.codice })).status).toBe(400);

    const annullato = (await api().post('/inviti').set(auth(tF)).send({})).body;
    expect((await api().post(`/inviti/${annullato.id}/annulla`).set(auth(tF))).status).toBe(204);
    expect((await registra({ nome: 'Z', email: 'z@test.com', codiceInvito: annullato.codice })).status).toBe(400);
    expect((await api().post(`/inviti/${annullato.id}/annulla`).set(auth(tF))).status).toBe(404);
  });

  it('con INVITI_OBBLIGATORI=1 un cliente senza codice non si registra', async () => {
    expect((await api().get('/registrazione/info')).body.invitoObbligatorio).toBe(false);
    process.env.INVITI_OBBLIGATORI = '1';
    expect((await api().get('/registrazione/info')).body.invitoObbligatorio).toBe(true);

    const senza = await registra({ nome: 'Senza', email: 'senza@test.com' });
    expect(senza.status).toBe(400);
    expect(senza.body.errore).toContain('codice invito');

    const inv = (await api().post('/inviti').set(auth(tF)).send({ nota: 'Sara' })).body;
    expect((await registra({ nome: 'Sara', email: 'sara@test.com', codiceInvito: inv.codice })).status).toBe(201);
    expect((await login('sara@test.com')).status).toBe(200);
  });
});

describe('Limiti ai tentativi', () => {
  it('8 password sbagliate dalla stessa rete, poi blocco (anche con quella giusta)', async () => {
    for (let i = 0; i < 8; i++) expect((await login('alessio@test.com', 'sbagliata', '10.0.0.1')).status).toBe(401);
    const bloccato = await login('alessio@test.com', 'sbagliata', '10.0.0.1');
    expect(bloccato.status).toBe(429);
    expect(bloccato.body.errore).toContain('Troppi tentativi');
    // chi sta indovinando non capisce se ha trovato la password giusta
    expect((await login('alessio@test.com', 'password123', '10.0.0.1')).status).toBe(429);
  });

  it('il blocco non ferma gli altri clienti sullo stesso Wi-Fi, né Alessio da un’altra rete', async () => {
    expect((await login('felice@test.com', 'password123', '10.0.0.1')).status).toBe(200);
    expect((await login('alessio@test.com', 'password123', '10.0.0.2')).status).toBe(200);
  });

  it('gli accessi riusciti non contano', async () => {
    for (let i = 0; i < 15; i++) expect((await login('felice@test.com', 'password123', '10.0.0.3')).status).toBe(200);
  });

  it('chi prova password su un account da tanti indirizzi diversi viene fermato comunque', async () => {
    let bloccato = false;
    for (let i = 0; i < 32 && !bloccato; i++) {
      if ((await login('giulia@test.com', 'sbagliata', `10.1.${i}.1`)).status === 429) bloccato = true;
    }
    expect(bloccato).toBe(true);
  });

  it('email esistenti e inesistenti rispondono in tempi simili (non si scopre chi è registrato)', async () => {
    const misura = async (email: string, ip: string) => {
      const t = performance.now();
      await login(email, 'sbagliata', ip);
      return performance.now() - t;
    };
    await misura('felice@test.com', '10.9.9.1'); // riscaldamento
    const esistente = await misura('felice@test.com', '10.9.9.2');
    const inesistente = await misura('nessuno@test.com', '10.9.9.3');
    // senza la protezione l'email inesistente risponderebbe molto più in fretta (niente bcrypt)
    expect(inesistente).toBeGreaterThan(esistente * 0.5);
  });

  it('registrazioni a raffica dalla stessa rete bloccate dopo circa 20', async () => {
    let bloccatoA = -1;
    for (let i = 0; i < 25 && bloccatoA < 0; i++) {
      const r = await registra({ nome: `Spam ${i}`, email: `spam${i}@test.com` }, '10.2.0.1');
      if (r.status === 429) bloccatoA = i;
    }
    expect(bloccatoA).toBeGreaterThanOrEqual(19);
  });
});
