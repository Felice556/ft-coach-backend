// Più trainer nella stessa app: ognuno vede e tocca SOLO i propri clienti.
// E un solo amministratore (Felice), l'unico che può invitare nuovi trainer.
import { beforeAll, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, inizioGiornata, prisma, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tM: string, tA: string, tP: string;
// Dati di Felice (admin) e del suo cliente Alessio
let schedaF: any, eserF: number, misuraF: number, invitoF: number;
// Dati di Marta e del suo cliente Paolo
let schedaM: any;

const registra = (dati: object) => api().post('/register').send({ password: 'password123', ...dati });

beforeAll(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  [tF, tM, tA, tP] = await Promise.all(
    ['felice@test.com', 'marta@test.com', 'alessio@test.com', 'paolo@test.com'].map((e) => token(e)),
  );

  // Felice: una scheda per Alessio, con una serie registrata, un allenamento concluso, una misura e un invito.
  schedaF = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id))).body;
  eserF = schedaF.esercizi[0].id;
  await api().post('/registro').set(auth(tA)).send({ esercizioId: eserF, pesoUsato: 60, repsFatte: 8 });
  await api().post('/sessioni').set(auth(tA)).send({ schedaId: schedaF.id, inizioGiornata: inizioGiornata() });
  const oggi = new Date().toISOString().slice(0, 10);
  misuraF = (await api().put('/misure').set(auth(tF)).send({ tipo: 'MASSA_GRASSA', valore: 15, data: oggi, clienteId: ids.alessio.id })).body.id;
  invitoF = (await api().post('/inviti').set(auth(tF)).send({ nota: 'Cliente di Felice' })).body.id;

  // Marta: una scheda per Paolo.
  schedaM = (await api().post('/schede').set(auth(tM)).send(schedaDiProva(ids.paolo.id))).body;
});

describe('Ogni trainer vede solo i propri clienti', () => {
  it('elenco clienti: Felice vede i suoi, Marta solo Paolo', async () => {
    const f = await api().get('/clienti').set(auth(tF));
    expect(f.body.map((c: any) => c.nome)).toEqual(['Alessio', 'Giulia']);
    const m = await api().get('/clienti').set(auth(tM));
    expect(m.body.map((c: any) => c.nome)).toEqual(['Paolo']);
  });

  it('schede: Marta non vede quelle di Felice, nemmeno chiedendo il cliente per id', async () => {
    const tutte = await api().get('/schede').set(auth(tM));
    expect(tutte.body.map((s: any) => s.id)).toEqual([schedaM.id]);
    const perId = await api().get(`/schede?clienteId=${ids.alessio.id}`).set(auth(tM));
    expect(perId.body).toEqual([]);
    const archivio = await api().get('/schede?archiviate=1').set(auth(tM));
    expect(archivio.body).toEqual([]);
    // E Felice non vede quella di Marta
    const f = await api().get('/schede').set(auth(tF));
    expect(f.body.map((s: any) => s.id)).not.toContain(schedaM.id);
  });

  it('Marta non può creare schede per i clienti di Felice né spostarci le sue', async () => {
    expect((await api().post('/schede').set(auth(tM)).send(schedaDiProva(ids.alessio.id))).status).toBe(400);
    const sposta = await api().put(`/schede/${schedaM.id}`).set(auth(tM)).send({ nome: 'X', clienteId: ids.alessio.id });
    expect(sposta.status).toBe(400);
  });

  it('Marta non può modificare, archiviare, ripristinare o eliminare le schede di Felice', async () => {
    expect((await api().put(`/schede/${schedaF.id}`).set(auth(tM)).send({ nome: 'Rubata' })).status).toBe(404);
    expect((await api().post(`/schede/${schedaF.id}/archivia`).set(auth(tM))).status).toBe(404);
    expect((await api().post(`/schede/${schedaF.id}/ripristina`).set(auth(tM))).status).toBe(404);
    expect((await api().delete(`/schede/${schedaF.id}`).set(auth(tM))).status).toBe(404);
    const ancora = await prisma.scheda.findUnique({ where: { id: schedaF.id } });
    expect(ancora?.nome).toBe('Full Body A');
    expect(ancora?.archiviataIl).toBeNull();
  });

  it('Marta non vede lo storico né gli esercizi delle schede di Felice', async () => {
    expect((await api().get(`/schede/${schedaF.id}/storico`).set(auth(tM))).status).toBe(404);
    expect((await api().get(`/schede/${schedaF.id}/esercizi-archiviati`).set(auth(tM))).body).toEqual([]);
    expect((await api().get(`/registro/${eserF}`).set(auth(tM))).status).toBe(404);
  });

  it('Marta non può modificare, togliere o rimettere gli esercizi di Felice', async () => {
    expect((await api().put(`/esercizi/${eserF}`).set(auth(tM)).send({ nome: 'Rubato' })).status).toBe(404);
    expect((await api().delete(`/esercizi/${eserF}`).set(auth(tM))).status).toBe(404);
    expect((await api().post(`/esercizi/${eserF}/ripristina`).set(auth(tM))).status).toBe(404);
    const es = await prisma.esercizio.findUnique({ where: { id: eserF } });
    expect(es?.nome).toBe('Panca piana');
    expect(es?.archiviatoIl).toBeNull();
  });

  it('allenamenti conclusi: Marta non vede quelli dei clienti di Felice', async () => {
    const tutte = await api().get('/sessioni').set(auth(tM));
    expect(tutte.body).toEqual([]);
    const perId = await api().get(`/sessioni?clienteId=${ids.alessio.id}`).set(auth(tM));
    expect(perId.body).toEqual([]);
    const f = await api().get('/sessioni').set(auth(tF));
    expect(f.body.length).toBe(1);
  });

  it('misure: Marta non legge, non scrive e non cancella quelle dei clienti di Felice', async () => {
    expect((await api().get(`/misure?clienteId=${ids.alessio.id}`).set(auth(tM))).status).toBe(404);
    const oggi = new Date().toISOString().slice(0, 10);
    const scrivi = await api().put('/misure').set(auth(tM)).send({ tipo: 'MASSA_GRASSA', valore: 30, data: oggi, clienteId: ids.alessio.id });
    expect(scrivi.status).toBe(404);
    expect((await api().delete(`/misure/${misuraF}`).set(auth(tM))).status).toBe(404);
    const m = await prisma.misuraCorporea.findUnique({ where: { id: misuraF } });
    expect(m?.valore).toBe(15);
  });

  it('accessi: Marta non può cambiare password o email ai clienti di Felice', async () => {
    expect((await api().put(`/clienti/${ids.alessio.id}/password`).set(auth(tM)).send({ nuovaPassword: 'nuovapass123' })).status).toBe(404);
    expect((await api().put(`/clienti/${ids.alessio.id}/email`).set(auth(tM)).send({ email: 'rubata@test.com' })).status).toBe(404);
    // Alessio entra ancora con la sua password e la sua email
    expect((await api().post('/login').send({ email: 'alessio@test.com', password: 'password123' })).status).toBe(200);
  });

  it('inviti clienti: ognuno vede e annulla solo i propri', async () => {
    expect((await api().get('/inviti').set(auth(tM))).body).toEqual([]);
    expect((await api().post(`/inviti/${invitoF}/annulla`).set(auth(tM))).status).toBe(404);
    const f = await api().get('/inviti').set(auth(tF));
    expect(f.body.find((i: any) => i.id === invitoF)?.stato).toBe('attivo');
  });

  it('anche l’amministratore vede solo i propri clienti: niente accesso ai dati di Paolo', async () => {
    expect((await api().put(`/schede/${schedaM.id}`).set(auth(tF)).send({ nome: 'X' })).status).toBe(404);
    expect((await api().get(`/misure?clienteId=${ids.paolo.id}`).set(auth(tF))).status).toBe(404);
    expect((await api().get(`/sessioni?clienteId=${ids.paolo.id}`).set(auth(tF))).body).toEqual([]);
  });

  it('un cliente registrato con l’invito di Marta diventa cliente di Marta', async () => {
    const inv = (await api().post('/inviti').set(auth(tM)).send({ nota: 'Luca' })).body;
    expect((await registra({ nome: 'Luca', email: 'luca@test.com', codiceInvito: inv.codice })).status).toBe(201);
    const m = await api().get('/clienti').set(auth(tM));
    expect(m.body.map((c: any) => c.nome)).toContain('Luca');
    const f = await api().get('/clienti').set(auth(tF));
    expect(f.body.map((c: any) => c.nome)).not.toContain('Luca');
  });

  it('un cliente registrato senza invito (inviti facoltativi) va all’amministratore', async () => {
    expect((await registra({ nome: 'Sara', email: 'sara@test.com' })).status).toBe(201);
    const sara = await prisma.user.findUnique({ where: { email: 'sara@test.com' } });
    expect(sara?.trainerId).toBe(ids.trainer.id);
    expect(sara?.ruolo).toBe('CLIENTE');
  });
});

describe('Un solo amministratore: Felice', () => {
  it('chi è: solo Felice risulta amministratore', async () => {
    expect((await api().get('/me').set(auth(tF))).body).toMatchObject({ nome: 'Felice', admin: true });
    expect((await api().get('/me').set(auth(tM))).body).toMatchObject({ nome: 'Marta', admin: false });
    expect((await api().get('/me').set(auth(tA))).body).toMatchObject({ ruolo: 'CLIENTE', admin: false });
    expect((await api().get('/me')).status).toBe(401);
  });

  it('solo l’amministratore crea, vede e annulla gli inviti trainer', async () => {
    for (const t of [tM, tA, tP]) {
      expect((await api().post('/admin/inviti-trainer').set(auth(t)).send({})).status).toBe(403);
      expect((await api().get('/admin/inviti-trainer').set(auth(t))).status).toBe(403);
    }
    expect((await api().post('/admin/inviti-trainer').send({})).status).toBe(401);
    const r = await api().post('/admin/inviti-trainer').set(auth(tF)).send({ nota: 'Coach Roberto', giorni: 7 });
    expect(r.status).toBe(201);
    expect(r.body.ruolo).toBe('TRAINER');
    const elenco = await api().get('/admin/inviti-trainer').set(auth(tF));
    expect(elenco.body.map((i: any) => i.nota)).toEqual(['Coach Roberto']);
    // Gli inviti trainer non si mischiano con quelli dei clienti
    expect((await api().get('/inviti').set(auth(tF))).body.some((i: any) => i.ruolo === 'TRAINER')).toBe(false);
    // Marta non può annullarlo nemmeno conoscendo l'id
    expect((await api().post(`/admin/inviti-trainer/${r.body.id}/annulla`).set(auth(tM))).status).toBe(403);
    expect((await api().post(`/inviti/${r.body.id}/annulla`).set(auth(tM))).status).toBe(404);
  });

  it('con un invito trainer ci si registra come trainer, NON amministratore, una volta sola', async () => {
    const inv = (await api().post('/admin/inviti-trainer').set(auth(tF)).send({ nota: 'Roberto' })).body;
    // Con un invito trainer non ci si registra come cliente…
    const comeCliente = await registra({ nome: 'Roberto', email: 'roberto@test.com', codiceInvito: inv.codice });
    expect(comeCliente.status).toBe(400);
    // …ma come trainer sì. Il campo "admin" mandato da fuori viene ignorato.
    const ok = await registra({ nome: 'Roberto', email: 'roberto@test.com', ruolo: 'TRAINER', codiceInvito: inv.codice, admin: true });
    expect(ok.status).toBe(201);
    const roberto = await prisma.user.findUnique({ where: { email: 'roberto@test.com' } });
    expect(roberto).toMatchObject({ ruolo: 'TRAINER', admin: false, trainerId: null });
    // Il codice non si riusa
    const ancora = await registra({ nome: 'Furbo', email: 'furbo2@test.com', ruolo: 'TRAINER', codiceInvito: inv.codice });
    expect(ancora.status).toBe(400);
    // Il nuovo trainer parte da zero: nessun cliente, nessuna scheda
    const tR = await token('roberto@test.com');
    expect((await api().get('/clienti').set(auth(tR))).body).toEqual([]);
    expect((await api().get('/schede').set(auth(tR))).body).toEqual([]);
    expect((await api().get('/me').set(auth(tR))).body.admin).toBe(false);
    expect((await api().post('/admin/inviti-trainer').set(auth(tR)).send({})).status).toBe(403);
  });

  it('un invito cliente non crea un trainer', async () => {
    const inv = (await api().post('/inviti').set(auth(tM)).send({})).body;
    const r = await registra({ nome: 'Furbo', email: 'furbo3@test.com', ruolo: 'TRAINER', codiceInvito: inv.codice });
    expect(r.status).toBe(400);
    expect(await prisma.user.count({ where: { email: 'furbo3@test.com' } })).toBe(0);
    // L'invito resta valido per il cliente vero
    expect((await registra({ nome: 'Vero', email: 'vero@test.com', codiceInvito: inv.codice })).status).toBe(201);
  });

  it('un invito trainer annullato non vale più', async () => {
    const inv = (await api().post('/admin/inviti-trainer').set(auth(tF)).send({})).body;
    expect((await api().post(`/admin/inviti-trainer/${inv.id}/annulla`).set(auth(tF))).status).toBe(204);
    const r = await registra({ nome: 'Tardi', email: 'tardi@test.com', ruolo: 'TRAINER', codiceInvito: inv.codice });
    expect(r.status).toBe(400);
  });

  it('alla fine l’amministratore è sempre e solo uno', async () => {
    const admin = await prisma.user.findMany({ where: { admin: true }, select: { email: true } });
    expect(admin).toEqual([{ email: 'felice@test.com' }]);
  });
});
