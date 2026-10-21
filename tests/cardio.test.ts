// Cardio e passi: il trainer decide il piano e l'obiettivo di passi, il cliente segna cosa ha fatto.
// Ognuno vede solo quello che gli spetta: niente dati di clienti di altri trainer.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, prisma, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tA: string, tM: string, tP: string;

const oggi = () => new Date().toISOString().slice(0, 10);
const giorno = (fa: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - fa);
  return d.toISOString().slice(0, 10);
};

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  [tF, tA, tM, tP] = await Promise.all(
    ['felice@test.com', 'alessio@test.com', 'marta@test.com', 'paolo@test.com'].map((e) => token(e)),
  );
});

const camminata = (clienteId: number) => ({ clienteId, attivita: 'Camminata in salita', minuti: 30, volteSettimana: 3, nota: 'Pendenza 8%' });

describe('Piano cardio (trainer)', () => {
  it('il trainer crea, modifica e toglie le attività del piano di un suo cliente', async () => {
    const r = await api().post('/cardio/obiettivi').set(auth(tF)).send(camminata(ids.alessio.id));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ attivita: 'Camminata in salita', minuti: 30, volteSettimana: 3, nota: 'Pendenza 8%' });

    const m = await api().put(`/cardio/obiettivi/${r.body.id}`).set(auth(tF)).send({ attivita: 'Bici', minuti: 40, volteSettimana: 2 });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ attivita: 'Bici', minuti: 40, volteSettimana: 2, nota: null });

    const vista = await api().get('/cardio').set(auth(tA));
    expect(vista.body.obiettivi).toHaveLength(1);

    expect((await api().delete(`/cardio/obiettivi/${r.body.id}`).set(auth(tF))).status).toBe(204);
    expect((await api().get('/cardio').set(auth(tA))).body.obiettivi).toEqual([]);
  });

  it('un trainer non tocca il piano dei clienti di un altro trainer', async () => {
    expect((await api().post('/cardio/obiettivi').set(auth(tM)).send(camminata(ids.alessio.id))).status).toBe(404);
    const suo = (await api().post('/cardio/obiettivi').set(auth(tF)).send(camminata(ids.alessio.id))).body;
    expect((await api().put(`/cardio/obiettivi/${suo.id}`).set(auth(tM)).send({ attivita: 'X', minuti: 10, volteSettimana: 1 })).status).toBe(404);
    expect((await api().delete(`/cardio/obiettivi/${suo.id}`).set(auth(tM))).status).toBe(404);
    expect((await api().get(`/cardio?clienteId=${ids.alessio.id}`).set(auth(tM))).status).toBe(404);
    expect((await api().put('/cardio/obiettivo-passi').set(auth(tM)).send({ clienteId: ids.alessio.id, passi: 8000 })).status).toBe(404);
  });

  it('il cliente non può scrivere il piano, e il trainer non può segnare cardio o passi al posto suo', async () => {
    expect((await api().post('/cardio/obiettivi').set(auth(tA)).send(camminata(ids.alessio.id))).status).toBe(403);
    expect((await api().put('/cardio/obiettivo-passi').set(auth(tA)).send({ clienteId: ids.alessio.id, passi: 8000 })).status).toBe(403);
    expect((await api().post('/cardio/sessioni').set(auth(tF)).send({ attivita: 'Bici', minuti: 20, data: oggi() })).status).toBe(403);
    expect((await api().put('/cardio/passi').set(auth(tF)).send({ data: oggi(), passi: 5000 })).status).toBe(403);
  });

  it('valori assurdi vengono rifiutati e il piano ha al massimo 10 attività', async () => {
    const base = camminata(ids.alessio.id);
    for (const sbagliato of [{ minuti: 0 }, { minuti: 601 }, { volteSettimana: 15 }, { attivita: '' }, { attivita: 'x'.repeat(61) }]) {
      expect((await api().post('/cardio/obiettivi').set(auth(tF)).send({ ...base, ...sbagliato })).status).toBe(400);
    }
    for (let i = 0; i < 10; i++) await api().post('/cardio/obiettivi').set(auth(tF)).send(base);
    const undicesima = await api().post('/cardio/obiettivi').set(auth(tF)).send(base);
    expect(undicesima.status).toBe(400);
    expect(undicesima.body.errore).toBe('Il piano cardio può avere al massimo 10 attività');
  });

  it('obiettivo di passi: si imposta, si toglie e il cliente lo vede', async () => {
    expect((await api().put('/cardio/obiettivo-passi').set(auth(tF)).send({ clienteId: ids.alessio.id, passi: 8000 })).body).toEqual({ obiettivoPassi: 8000 });
    expect((await api().get('/cardio').set(auth(tA))).body.obiettivoPassi).toBe(8000);
    expect((await api().put('/cardio/obiettivo-passi').set(auth(tF)).send({ clienteId: ids.alessio.id, passi: 500 })).status).toBe(400);
    await api().put('/cardio/obiettivo-passi').set(auth(tF)).send({ clienteId: ids.alessio.id, passi: null });
    expect((await api().get(`/cardio?clienteId=${ids.alessio.id}`).set(auth(tF))).body.obiettivoPassi).toBeNull();
  });
});

describe('Cardio fatto e passi (cliente)', () => {
  it('il cliente segna il cardio fatto, anche collegato al piano, e il trainer lo vede', async () => {
    const piano = (await api().post('/cardio/obiettivi').set(auth(tF)).send(camminata(ids.alessio.id))).body;
    const r = await api()
      .post('/cardio/sessioni')
      .set(auth(tA))
      .send({ attivita: 'Camminata in salita', minuti: 32, distanzaKm: 3.456, data: oggi(), obiettivoId: piano.id, nota: 'Fatta a digiuno' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ minuti: 32, distanzaKm: 3.46, obiettivoId: piano.id, nota: 'Fatta a digiuno' });
    await api().post('/cardio/sessioni').set(auth(tA)).send({ attivita: 'Nuoto', minuti: 45, data: giorno(2) });

    const delTrainer = await api().get(`/cardio?clienteId=${ids.alessio.id}`).set(auth(tF));
    expect(delTrainer.status).toBe(200);
    expect(delTrainer.body.sessioni.map((s: { attivita: string }) => s.attivita)).toEqual(['Camminata in salita', 'Nuoto']);
  });

  it('togliendo un’attività dal piano, il cardio già fatto resta', async () => {
    const piano = (await api().post('/cardio/obiettivi').set(auth(tF)).send(camminata(ids.alessio.id))).body;
    await api().post('/cardio/sessioni').set(auth(tA)).send({ attivita: 'Camminata in salita', minuti: 30, data: oggi(), obiettivoId: piano.id });
    await api().delete(`/cardio/obiettivi/${piano.id}`).set(auth(tF));
    const sessioni = (await api().get('/cardio').set(auth(tA))).body.sessioni;
    expect(sessioni).toHaveLength(1);
    expect(sessioni[0]).toMatchObject({ attivita: 'Camminata in salita', obiettivoId: null });
  });

  it('non si può collegare il cardio al piano di un altro cliente, né cancellare il cardio altrui', async () => {
    const pianoGiulia = (await api().post('/cardio/obiettivi').set(auth(tF)).send(camminata(ids.giulia.id))).body;
    const r = await api().post('/cardio/sessioni').set(auth(tA)).send({ attivita: 'X', minuti: 10, data: oggi(), obiettivoId: pianoGiulia.id });
    expect(r.status).toBe(404);
    const diPaolo = (await api().post('/cardio/sessioni').set(auth(tP)).send({ attivita: 'Bici', minuti: 20, data: oggi() })).body;
    expect((await api().delete(`/cardio/sessioni/${diPaolo.id}`).set(auth(tA))).status).toBe(404);
    expect((await api().delete(`/cardio/sessioni/${diPaolo.id}`).set(auth(tP))).status).toBe(204);
  });

  it('niente date future né minuti o distanze assurde', async () => {
    const domani = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    for (const sbagliato of [{ data: domani }, { data: '2026-02-30' }, { minuti: 0 }, { minuti: 700 }, { distanzaKm: 500 }]) {
      const r = await api().post('/cardio/sessioni').set(auth(tA)).send({ attivita: 'Bici', minuti: 20, data: oggi(), ...sbagliato });
      expect(r.status).toBe(400);
    }
  });

  it('passi: uno per giorno, reinserendo si corregge; il trainer li vede', async () => {
    await api().put('/cardio/passi').set(auth(tA)).send({ data: oggi(), passi: 5400 });
    const corretto = await api().put('/cardio/passi').set(auth(tA)).send({ data: oggi(), passi: 8123 });
    expect(corretto.body.passi).toBe(8123);
    await api().put('/cardio/passi').set(auth(tA)).send({ data: giorno(1), passi: 10500 });
    expect((await api().put('/cardio/passi').set(auth(tA)).send({ data: oggi(), passi: 100001 })).status).toBe(400);

    const passi = (await api().get(`/cardio?clienteId=${ids.alessio.id}`).set(auth(tF))).body.passi;
    expect(passi.map((p: { passi: number }) => p.passi)).toEqual([10500, 8123]);
    expect(await prisma.passiGiornalieri.count({ where: { clienteId: ids.alessio.id } })).toBe(2);
  });

  it('il cliente vede solo i propri dati', async () => {
    await api().put('/cardio/passi').set(auth(tP)).send({ data: oggi(), passi: 3000 });
    // Anche chiedendo un altro cliente, il cliente riceve sempre e solo i suoi dati.
    const r = await api().get(`/cardio?clienteId=${ids.paolo.id}`).set(auth(tA));
    expect(r.status).toBe(200);
    expect(r.body.passi).toEqual([]);
  });

  it('eliminando l’account del cliente si cancellano anche cardio e passi', async () => {
    await api().post('/cardio/obiettivi').set(auth(tF)).send(camminata(ids.alessio.id));
    await api().post('/cardio/sessioni').set(auth(tA)).send({ attivita: 'Bici', minuti: 20, data: oggi() });
    await api().put('/cardio/passi').set(auth(tA)).send({ data: oggi(), passi: 4000 });
    const r = await api().delete('/me').set(auth(tA)).send({ password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(204);
    const dove = { where: { clienteId: ids.alessio.id } };
    expect(await prisma.cardioFatto.count(dove)).toBe(0);
    expect(await prisma.obiettivoCardio.count(dove)).toBe(0);
    expect(await prisma.passiGiornalieri.count(dove)).toBe(0);
  });
});
