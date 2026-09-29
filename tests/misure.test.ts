import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;
let tF: string, tA: string, tG: string;
const oggi = new Date().toISOString().slice(0, 10);

const salva = (t: string, dati: object) => api().put('/misure').set(auth(t)).send(dati);

beforeAll(async () => {
  ids = await utentiDiPartenza();
  [tF, tA, tG] = await Promise.all([token('felice@test.com'), token('alessio@test.com'), token('giulia@test.com')]);
});

describe('Peso corporeo (lo scrive il cliente)', () => {
  it('il cliente salva il suo peso, arrotondato a un decimale', async () => {
    const r = await salva(tA, { tipo: 'PESO', valore: 80.46, data: '2026-09-01' });
    expect(r.status).toBe(200);
    expect(r.body.valore).toBe(80.5);
  });

  it('stesso giorno: il valore viene corretto, non duplicato', async () => {
    await salva(tA, { tipo: 'PESO', valore: 79, data: '2026-09-15' });
    const r = await salva(tA, { tipo: 'PESO', valore: 78.2, data: '2026-09-15' });
    expect(r.body.valore).toBe(78.2);
    const elenco = (await api().get('/misure').set(auth(tA))).body;
    expect(elenco).toHaveLength(2);
    expect(elenco[0].data.startsWith('2026-09-01')).toBe(true); // dal più vecchio
  });

  it('il trainer non inserisce il peso al posto del cliente', async () => {
    expect((await salva(tF, { tipo: 'PESO', valore: 80, data: oggi, clienteId: ids.alessio.id })).status).toBe(403);
  });

  it('un cliente non può scrivere sul profilo di un altro (il clienteId viene ignorato)', async () => {
    const r = await salva(tA, { tipo: 'PESO', valore: 80, data: oggi, clienteId: ids.giulia.id });
    expect(r.status).toBe(200);
    expect(r.body.clienteId).toBe(ids.alessio.id);
  });
});

describe('Massa grassa (la scrive il trainer)', () => {
  it('il trainer la inserisce per un cliente; il cliente non può', async () => {
    expect((await salva(tF, { tipo: 'MASSA_GRASSA', valore: 18.3, data: '2026-09-02', clienteId: ids.alessio.id })).status).toBe(200);
    expect((await salva(tA, { tipo: 'MASSA_GRASSA', valore: 15, data: oggi })).status).toBe(403);
  });

  it('il trainer deve indicare un cliente esistente', async () => {
    expect((await salva(tF, { tipo: 'MASSA_GRASSA', valore: 17, data: oggi })).status).toBe(400);
    expect((await salva(tF, { tipo: 'MASSA_GRASSA', valore: 17, data: oggi, clienteId: 99999 })).status).toBe(404);
    expect((await salva(tF, { tipo: 'MASSA_GRASSA', valore: 17, data: oggi, clienteId: ids.trainer.id })).status).toBe(404);
  });
});

describe('Chi vede cosa', () => {
  it('il trainer vede peso e massa grassa del cliente', async () => {
    const r = await api().get(`/misure?clienteId=${ids.alessio.id}`).set(auth(tF));
    expect(r.status).toBe(200);
    expect(r.body.map((m: { tipo: string }) => m.tipo).sort()).toEqual(['MASSA_GRASSA', 'PESO', 'PESO', 'PESO']);
  });

  it('un altro cliente non vede nulla di Alessio, neanche passando il suo id', async () => {
    expect((await api().get('/misure').set(auth(tG))).body).toEqual([]);
    expect((await api().get(`/misure?clienteId=${ids.alessio.id}`).set(auth(tG))).body).toEqual([]);
  });

  it('richieste non valide o senza accesso', async () => {
    expect((await api().get('/misure').set(auth(tF))).status).toBe(400);
    expect((await api().get('/misure?clienteId=abc').set(auth(tF))).status).toBe(400);
    expect((await api().get('/misure')).status).toBe(401);
  });
});

describe('Valori impossibili rifiutati', () => {
  it.each([
    ['peso 725 kg (errore di battitura)', { tipo: 'PESO', valore: 725, data: oggi }],
    ['data nel futuro', { tipo: 'PESO', valore: 80, data: '2030-01-01' }],
    ['data inesistente', { tipo: 'PESO', valore: 80, data: '2026-02-30' }],
    ['valore scritto come testo', { tipo: 'PESO', valore: '80', data: oggi }],
  ])('%s', async (_nome, dati) => {
    expect((await salva(tA, dati)).status).toBe(400);
  });

  it('massa grassa al 90%', async () => {
    expect((await salva(tF, { tipo: 'MASSA_GRASSA', valore: 90, data: oggi, clienteId: ids.alessio.id })).status).toBe(400);
  });
});

describe('Cancellare una misura sbagliata', () => {
  it('ognuno cancella solo quello che può scrivere', async () => {
    const tutte = (await api().get(`/misure?clienteId=${ids.alessio.id}`).set(auth(tF))).body;
    const peso = tutte.find((m: { tipo: string }) => m.tipo === 'PESO');
    const grasso = tutte.find((m: { tipo: string }) => m.tipo === 'MASSA_GRASSA');

    expect((await api().delete(`/misure/${peso.id}`).set(auth(tG))).status).toBe(404);
    expect((await api().delete(`/misure/${peso.id}`).set(auth(tF))).status).toBe(404);
    expect((await api().delete(`/misure/${grasso.id}`).set(auth(tA))).status).toBe(404);

    expect((await api().delete(`/misure/${peso.id}`).set(auth(tA))).status).toBe(204);
    expect((await api().delete(`/misure/${grasso.id}`).set(auth(tF))).status).toBe(204);
  });
});
