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
    expect((await api().get('/programmi/avvisi').set(auth(tS))).body).toEqual({ avvisi: ['principiante', 'intermedio'] });
    await avviso(tS, 'principiante', false);
    expect((await api().get('/programmi/avvisi').set(auth(tS))).body).toEqual({ avvisi: ['intermedio'] });
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
