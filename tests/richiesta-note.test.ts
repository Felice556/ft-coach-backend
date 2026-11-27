// "Guarda le mie note": il cliente chiede al suo trainer di leggere le note, il trainer la vede
// sul nome del cliente e la chiude con "Fatto". Solo tra cliente e il SUO trainer.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, creaUtente, prisma, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tM: string, tA: string;

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  [tF, tM, tA] = await Promise.all(['felice@test.com', 'marta@test.com', 'alessio@test.com'].map((e) => token(e)));
});

describe('Guarda le mie note', () => {
  it('il cliente chiede, il trainer la vede sul cliente, tocca "Fatto" e il cliente vede che le ha viste', async () => {
    const r = await api().post('/me/richiesta-note').set(auth(tA)).send({ messaggio: '  Guarda la panca, mi fa male la spalla  ' });
    expect(r.status).toBe(200);
    expect(r.body.richiestaNoteIl).toBeTruthy();
    expect(r.body.richiestaNoteTesto).toBe('Guarda la panca, mi fa male la spalla');

    const clienti = (await api().get('/clienti').set(auth(tF))).body;
    const alessio = clienti.find((c: any) => c.id === ids.alessio.id);
    const giulia = clienti.find((c: any) => c.id === ids.giulia.id);
    expect(alessio.richiestaNoteIl).toBeTruthy();
    expect(alessio.richiestaNoteTesto).toBe('Guarda la panca, mi fa male la spalla');
    expect(giulia.richiestaNoteIl).toBeNull();

    const fatto = await api().post(`/clienti/${ids.alessio.id}/note-viste`).set(auth(tF));
    expect(fatto.status).toBe(200);
    expect(fatto.body.richiestaNoteIl).toBeNull();
    const me = (await api().get('/me').set(auth(tA))).body;
    expect(me.richiestaNoteIl).toBeNull();
    expect(me.richiestaNoteTesto).toBeNull();
    expect(me.noteVisteIl).toBeTruthy();
  });

  it('senza messaggio va bene; il cliente può annullarla', async () => {
    expect((await api().post('/me/richiesta-note').set(auth(tA)).send({})).status).toBe(200);
    const annullata = await api().delete('/me/richiesta-note').set(auth(tA));
    expect(annullata.status).toBe(200);
    expect(annullata.body.richiestaNoteIl).toBeNull();
  });

  it('messaggio troppo lungo rifiutato; chi si allena da solo non può chiederlo', async () => {
    expect((await api().post('/me/richiesta-note').set(auth(tA)).send({ messaggio: 'x'.repeat(301) })).status).toBe(400);
    await creaUtente('Solo', 'solo@test.com', 'CLIENTE');
    const r = await api().post('/me/richiesta-note').set(auth(await token('solo@test.com'))).send({});
    expect(r.status).toBe(400);
    expect(r.body.errore).toMatch(/trainer/);
  });

  it('un altro trainer non vede la richiesta e non può chiuderla; il trainer non può mandarla', async () => {
    await api().post('/me/richiesta-note').set(auth(tA)).send({});
    expect((await api().get('/clienti').set(auth(tM))).body.some((c: any) => c.id === ids.alessio.id)).toBe(false);
    expect((await api().post(`/clienti/${ids.alessio.id}/note-viste`).set(auth(tM))).status).toBe(404);
    expect((await api().post('/me/richiesta-note').set(auth(tF)).send({})).status).toBe(403);
    const ancora = await prisma.user.findUnique({ where: { id: ids.alessio.id } });
    expect(ancora?.richiestaNoteIl).not.toBeNull();
  });

  it('se il cliente lascia il trainer la richiesta sparisce', async () => {
    await api().post('/me/richiesta-note').set(auth(tA)).send({ messaggio: 'ciao' });
    const r = await api().delete('/me/trainer').set(auth(tA)).send({ password: 'password123' });
    expect(r.status).toBe(200);
    const dopo = await prisma.user.findUnique({ where: { id: ids.alessio.id } });
    expect(dopo?.richiestaNoteIl).toBeNull();
    expect(dopo?.richiestaNoteTesto).toBeNull();
  });
});
