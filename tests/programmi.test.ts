// Programmi Liftio "in arrivo": il cliente chiede di essere avvisato, l'amministratore vede solo i numeri.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, creaUtente, prisma, token, utentiDiPartenza } from './aiuti';

let tF: string, tM: string, tS: string, tA: string;
let sara: { id: number };
const avviso = (t: string, chiave: string, attivo = true) => api().put(`/programmi/${chiave}/avviso`).set(auth(t)).send({ attivo });

beforeEach(async () => {
  await utentiDiPartenza();
  await altroTrainerConCliente();
  sara = await creaUtente('Sara', 'sara@test.com', 'CLIENTE');
  [tF, tM, tS, tA] = await Promise.all(['felice@test.com', 'marta@test.com', 'sara@test.com', 'alessio@test.com'].map((e) => token(e)));
});

describe('Avvisami sui programmi in arrivo', () => {
  it('si attiva, non si duplica, si toglie', async () => {
    expect((await avviso(tS, 'principiante')).body).toEqual({ programma: 'principiante', attivo: true });
    await avviso(tS, 'principiante');
    await avviso(tS, 'intermedio');
    expect((await api().get('/programmi/avvisi').set(auth(tS))).body).toEqual({ avvisi: ['principiante', 'intermedio'], annunci: [] });
    await avviso(tS, 'principiante', false);
    expect((await api().get('/programmi/avvisi').set(auth(tS))).body).toEqual({ avvisi: ['intermedio'], annunci: [] });
  });

  it('solo programmi esistenti, solo clienti', async () => {
    expect((await avviso(tS, 'inventato')).status).toBe(404);
    expect((await avviso(tS, 'intermedio').send({ attivo: 'si' })).status).toBe(400);
    expect((await avviso(tF, 'intermedio')).status).toBe(403);
  });

  it('l’amministratore vede solo quante persone aspettano ogni programma', async () => {
    await avviso(tS, 'intermedio');
    await avviso(tA, 'intermedio');
    await avviso(tA, 'avanzato');
    const r = await api().get('/admin/programmi').set(auth(tF));
    expect(r.body.conteggi).toMatchObject({ 'intermedio': 2, 'avanzato': 1, 'principiante': 0 });
    expect(JSON.stringify(r.body)).not.toContain('Sara');
    expect((await api().get('/admin/programmi').set(auth(tM))).status).toBe(403);
  });

  it('eliminando l’account gli avvisi spariscono', async () => {
    await avviso(tS, 'intermedio');
    expect((await api().delete('/me').set(auth(tS)).send({ password: 'password123', conferma: 'ELIMINA' })).status).toBe(204);
    expect(await prisma.avvisoProgramma.count({ where: { userId: sara.id } })).toBe(0);
  });
});

describe('Annunci dell’amministratore', () => {
  const annuncia = (t: string, chiave: string, messaggio = 'Il programma è pronto!') =>
    api().post(`/admin/programmi/${chiave}/annuncio`).set(auth(t)).send({ messaggio });

  it('l’amministratore vede quando è arrivato l’ultimo Avvisami', async () => {
    expect((await api().get('/admin/programmi').set(auth(tF))).body.ultimoAvvisoIl).toBeNull();
    await avviso(tS, 'principiante');
    expect((await api().get('/admin/programmi').set(auth(tF))).body.ultimoAvvisoIl).toBeTruthy();
  });

  it('l’annuncio arriva solo a chi aspetta quel programma; “visto” spegne il pallino', async () => {
    await avviso(tS, 'principiante');
    await avviso(tA, 'avanzato');
    const r = await annuncia(tF, 'principiante', 'Principiante disponibile da lunedì!');
    expect(r.status).toBe(201);
    expect(r.body.destinatari).toBe(1);

    const diSara = (await api().get('/programmi/avvisi').set(auth(tS))).body;
    expect(diSara.annunci.map((a: any) => a.messaggio)).toEqual(['Principiante disponibile da lunedì!']);
    expect((await api().get('/programmi/avvisi').set(auth(tA))).body.annunci).toEqual([]);

    expect((await api().post('/programmi/annunci/visti').set(auth(tS))).status).toBe(204);
    expect((await api().get('/programmi/avvisi').set(auth(tS))).body.annunci).toEqual([]);
    // Un annuncio nuovo riaccende il pallino
    await annuncia(tF, 'principiante', 'Seconda novità');
    expect((await api().get('/programmi/avvisi').set(auth(tS))).body.annunci).toHaveLength(1);
    expect((await api().get('/admin/programmi').set(auth(tF))).body.ultimiAnnunci.principiante.messaggio).toBe('Seconda novità');
  });

  it('solo l’amministratore manda annunci, su programmi esistenti e con un messaggio', async () => {
    expect((await annuncia(tM, 'principiante')).status).toBe(403);
    expect((await annuncia(tS, 'principiante')).status).toBe(403);
    expect((await annuncia(tF, 'inventato')).status).toBe(404);
    expect((await annuncia(tF, 'principiante', '  ')).status).toBe(400);
  });
});
