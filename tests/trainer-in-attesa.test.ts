// Trainer che trovano l'app da soli (es. dal Play Store) e si registrano SENZA invito:
// l'account esiste ma resta bloccato finché l'amministratore (Felice) non lo approva.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, prisma, schedaDiProva, token, utentiDiPartenza } from './aiuti';

const PRESENTAZIONE = 'Personal trainer a Napoli, seguo circa 20 clienti in palestra.';
const registraTrainer = (dati: object = {}) =>
  api().post('/register').send({ nome: 'Luca', email: 'luca@test.com', password: 'password123', ruolo: 'TRAINER', presentazione: PRESENTAZIONE, fasciaClienti: '11-30', ...dati });

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string;

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  tF = await token('felice@test.com');
});

describe('Trainer in attesa di approvazione', () => {
  it('si registra senza invito: account creato, in attesa, non amministratore', async () => {
    const r = await registraTrainer();
    expect(r.status).toBe(201);
    expect(r.body.inAttesa).toBe(true);
    const luca = await prisma.user.findUnique({ where: { email: 'luca@test.com' } });
    expect(luca).toMatchObject({ ruolo: 'TRAINER', approvato: false, admin: false, trainerId: null, presentazione: PRESENTAZIONE, fasciaClienti: '11-30' });
    expect(luca?.richiestaIl).not.toBeNull();
  });

  it('la presentazione è facoltativa: anche senza, la richiesta arriva (in attesa)', async () => {
    const r = await registraTrainer({ presentazione: undefined });
    expect(r.status).toBe(201);
    expect(r.body.inAttesa).toBe(true);
    const luca = await prisma.user.findUnique({ where: { email: 'luca@test.com' } });
    expect(luca).toMatchObject({ approvato: false, presentazione: null });
    // Troppo lunga invece no
    expect((await registraTrainer({ email: 'altro@test.com', presentazione: 'x'.repeat(501) })).status).toBe(400);
  });

  it('il numero di clienti (a fasce) è obbligatorio per chi non ha invito, e solo dalle fasce previste', async () => {
    const senza = await registraTrainer({ fasciaClienti: undefined });
    expect(senza.status).toBe(400);
    expect(senza.body.errore).toBe('Indica quanti clienti segui');
    expect((await registraTrainer({ fasciaClienti: '1000' })).status).toBe(400);
    expect(await prisma.user.count({ where: { email: 'luca@test.com' } })).toBe(0);
  });

  it('in attesa può accedere ma non può fare niente, tranne sapere chi è ed eliminare il suo account', async () => {
    await registraTrainer();
    const login = await api().post('/login').send({ email: 'luca@test.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.inAttesa).toBe(true);
    const tL = login.body.token as string;

    const me = await api().get('/me').set(auth(tL));
    expect(me.status).toBe(200);
    expect(me.body.inAttesa).toBe(true);

    for (const r of [
      await api().get('/clienti').set(auth(tL)),
      await api().get('/schede').set(auth(tL)),
      await api().post('/inviti').set(auth(tL)).send({ nota: 'x' }),
      await api().get('/inviti').set(auth(tL)),
      await api().post('/schede').set(auth(tL)).send(schedaDiProva(ids.alessio.id)),
      await api().get('/preset-esercizi').set(auth(tL)),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.codice).toBe('IN_ATTESA');
    }
    // Se ci ripensa, può eliminare la sua richiesta.
    expect((await api().delete('/me').set(auth(tL)).send({ password: 'password123', conferma: 'ELIMINA' })).status).toBe(204);
    expect(await prisma.user.count({ where: { email: 'luca@test.com' } })).toBe(0);
  });

  it("solo l'amministratore vede le richieste: non un altro trainer, non un cliente", async () => {
    await registraTrainer();
    const lista = await api().get('/admin/trainer-in-attesa').set(auth(tF));
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0]).toMatchObject({ nome: 'Luca', email: 'luca@test.com', presentazione: PRESENTAZIONE, fasciaClienti: '11-30' });
    expect(lista.body[0].password).toBeUndefined();

    const tM = await token('marta@test.com');
    const tA = await token('alessio@test.com');
    expect((await api().get('/admin/trainer-in-attesa').set(auth(tM))).status).toBe(403);
    expect((await api().get('/admin/trainer-in-attesa').set(auth(tA))).status).toBe(403);
    const id = lista.body[0].id;
    expect((await api().post(`/admin/trainer/${id}/approva`).set(auth(tM))).status).toBe(403);
    expect((await api().post(`/admin/trainer/${id}/rifiuta`).set(auth(tM))).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id } }))?.approvato).toBe(false);
  });

  it("l'amministratore approva: da quel momento il trainer usa l'app normalmente (non diventa admin)", async () => {
    await registraTrainer();
    const tL = await token('luca@test.com');
    const id = (await prisma.user.findUnique({ where: { email: 'luca@test.com' } }))!.id;
    // Nella panoramica dei trainer non compare finché è in attesa
    const prima = await api().get('/admin/trainer').set(auth(tF));
    expect(prima.body.trainer.map((t: any) => t.nome)).not.toContain('Luca');

    expect((await api().post(`/admin/trainer/${id}/approva`).set(auth(tF))).status).toBe(204);
    // Lo stesso accesso di prima ora funziona: nessun nuovo login necessario
    const clienti = await api().get('/clienti').set(auth(tL));
    expect(clienti.status).toBe(200);
    expect(clienti.body).toEqual([]); // nessun cliente: non vede quelli degli altri
    expect((await api().get('/me').set(auth(tL))).body).toMatchObject({ inAttesa: false, admin: false });
    expect((await api().get('/admin/trainer-in-attesa').set(auth(tF))).body).toEqual([]);
    const dopo = await api().get('/admin/trainer').set(auth(tF));
    expect(dopo.body.trainer.map((t: any) => t.nome)).toContain('Luca');
    // Approvare due volte: la richiesta non c'è più
    expect((await api().post(`/admin/trainer/${id}/approva`).set(auth(tF))).status).toBe(404);
  });

  it("l'amministratore rifiuta: l'account in attesa viene cancellato", async () => {
    await registraTrainer();
    const id = (await prisma.user.findUnique({ where: { email: 'luca@test.com' } }))!.id;
    expect((await api().post(`/admin/trainer/${id}/rifiuta`).set(auth(tF))).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect((await api().post('/login').send({ email: 'luca@test.com', password: 'password123' })).status).toBe(401);
  });

  it('approva e rifiuta funzionano SOLO sui trainer in attesa: mai su trainer attivi, clienti o admin', async () => {
    for (const id of [ids.marta.id, ids.alessio.id, ids.trainer.id]) {
      expect((await api().post(`/admin/trainer/${id}/rifiuta`).set(auth(tF))).status).toBe(404);
      expect((await api().post(`/admin/trainer/${id}/approva`).set(auth(tF))).status).toBe(404);
    }
    expect(await prisma.user.count()).toBe(5); // Felice, Alessio, Giulia, Marta, Paolo: tutti ancora lì
  });

  it('con un invito trainer si è subito attivi, come prima', async () => {
    const inv = (await api().post('/admin/inviti-trainer').set(auth(tF)).send({ nota: 'Luca' })).body;
    const r = await registraTrainer({ codiceInvito: inv.codice, presentazione: undefined, fasciaClienti: undefined });
    expect(r.status).toBe(201);
    expect(r.body.inAttesa).toBe(false);
    expect((await prisma.user.findUnique({ where: { email: 'luca@test.com' } }))?.approvato).toBe(true);
  });

  it('i clienti non sono toccati: si registrano e lavorano come prima', async () => {
    const tA = await token('alessio@test.com');
    expect((await api().get('/schede').set(auth(tA))).status).toBe(200);
    expect((await api().get('/me').set(auth(tA))).body.inAttesa).toBe(false);
  });
});
