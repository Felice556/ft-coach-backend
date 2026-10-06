import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, creaUtente, token, utentiDiPartenza } from './aiuti';

let tF: string, tA: string, tAltro: string;

beforeAll(async () => {
  await utentiDiPartenza();
  await creaUtente('Altro trainer', 'altro@test.com', 'TRAINER');
  [tF, tA, tAltro] = await Promise.all([token('felice@test.com'), token('alessio@test.com'), token('altro@test.com')]);
});

describe('Libreria esercizi divisa per gruppi muscolari', () => {
  let pancaId: number;

  it('il trainer salva un esercizio con il suo gruppo', async () => {
    const r = await api().post('/preset-esercizi').set(auth(tF)).send({ nome: 'Panca piana', gruppo: 'PETTO' });
    expect(r.status).toBe(201);
    expect(r.body.gruppo).toBe('PETTO');
    pancaId = r.body.id;
  });

  it('senza gruppo va bene lo stesso (esercizi salvati prima)', async () => {
    const r = await api().post('/preset-esercizi').set(auth(tF)).send({ nome: 'Plank' });
    expect(r.status).toBe(201);
    expect(r.body.gruppo).toBeNull();
  });

  it('si sposta in un altro gruppo senza toccare il resto', async () => {
    const r = await api().patch(`/preset-esercizi/${pancaId}`).set(auth(tF)).send({ gruppo: 'SPALLE' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nome: 'Panca piana', gruppo: 'SPALLE' });
    const elenco = (await api().get('/preset-esercizi').set(auth(tF))).body;
    expect(elenco.find((p: { id: number }) => p.id === pancaId).gruppo).toBe('SPALLE');
  });

  it('gruppi inventati rifiutati', async () => {
    expect((await api().post('/preset-esercizi').set(auth(tF)).send({ nome: 'X', gruppo: 'COLLO' })).status).toBe(400);
    expect((await api().patch(`/preset-esercizi/${pancaId}`).set(auth(tF)).send({ gruppo: 'COLLO' })).status).toBe(400);
  });

  it('un altro trainer non modifica la mia libreria, un cliente nemmeno', async () => {
    expect((await api().patch(`/preset-esercizi/${pancaId}`).set(auth(tAltro)).send({ gruppo: 'GAMBE' })).status).toBe(404);
    expect((await api().patch(`/preset-esercizi/${pancaId}`).set(auth(tA)).send({ gruppo: 'GAMBE' })).status).toBe(403);
    const elenco = (await api().get('/preset-esercizi').set(auth(tF))).body;
    expect(elenco.find((p: { id: number }) => p.id === pancaId).gruppo).toBe('SPALLE');
  });
});
