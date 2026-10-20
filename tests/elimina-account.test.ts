// Eliminare il proprio account (richiesto da Google Play e dal GDPR):
// definitivo, quindi protetto da password + "ELIMINA", e con regole che evitano danni.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, creaUtente, inizioGiornata, prisma, schedaDiProva, token, utentiDiPartenza } from './aiuti';

const elimina = (t: string, corpo: object) => api().delete('/me').set(auth(t)).send(corpo);

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tA: string, tG: string;

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  [tF, tA, tG] = await Promise.all(['felice@test.com', 'alessio@test.com', 'giulia@test.com'].map((e) => token(e)));
});

// Alessio con tutto quello che un cliente può avere: scheda, serie, allenamento concluso, misure, invito usato.
async function alessioConDati() {
  const invito = (await api().post('/inviti').set(auth(tF)).send({ nota: 'Per Alessio' })).body;
  await prisma.invito.update({ where: { id: invito.id }, data: { usatoDaId: ids.alessio.id, usatoIl: new Date() } });
  const scheda = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id))).body;
  await api().post('/registro').set(auth(tA)).send({ esercizioId: scheda.esercizi[0].id, pesoUsato: 60, repsFatte: 8 });
  await api().post('/sessioni').set(auth(tA)).send({ schedaId: scheda.id, inizioGiornata: inizioGiornata() });
  const oggi = new Date().toISOString().slice(0, 10);
  await api().put('/misure').set(auth(tA)).send({ tipo: 'PESO', valore: 80, data: oggi });
  await api().put('/misure').set(auth(tF)).send({ tipo: 'MASSA_GRASSA', valore: 15, data: oggi, clienteId: ids.alessio.id });
  return { invito, scheda };
}

describe('Eliminare il proprio account', () => {
  it('senza la parola ELIMINA o con la password sbagliata non succede niente', async () => {
    expect((await elimina(tA, { password: 'password123', conferma: 'si' })).status).toBe(400);
    const r = await elimina(tA, { password: 'sbagliata', conferma: 'ELIMINA' });
    expect(r.status).toBe(400);
    expect(r.body.errore).toBe('La password non è corretta');
    expect(await prisma.user.findUnique({ where: { id: ids.alessio.id } })).not.toBeNull();
  });

  it('un cliente elimina il suo account e tutti i suoi dati, senza toccare quelli degli altri', async () => {
    const { invito } = await alessioConDati();
    // Anche Giulia ha una scheda: deve restare intatta.
    const schedaG = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.giulia.id))).body;

    const r = await elimina(tA, { password: 'password123', conferma: 'elimina ' });
    expect(r.status).toBe(204);

    const id = ids.alessio.id;
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.scheda.count({ where: { clienteId: id } })).toBe(0);
    expect(await prisma.registroAllenamento.count({ where: { clienteId: id } })).toBe(0);
    expect(await prisma.sessioneAllenamento.count({ where: { clienteId: id } })).toBe(0);
    expect(await prisma.misuraCorporea.count({ where: { clienteId: id } })).toBe(0);
    // L'invito resta nello storico del trainer, senza più il collegamento all'account.
    const inv = await prisma.invito.findUnique({ where: { id: invito.id } });
    expect(inv?.usatoDaId).toBeNull();
    expect(inv?.usatoIl).not.toBeNull();

    // Il vecchio accesso non funziona più, e la scheda di Giulia c'è ancora.
    expect((await api().get('/schede').set(auth(tA))).status).toBe(401);
    expect(await prisma.scheda.findUnique({ where: { id: schedaG.id } })).not.toBeNull();
    const clienti = await api().get('/clienti').set(auth(tF));
    expect(clienti.body.map((c: any) => c.nome)).toEqual(['Giulia']);
  });

  it("l'amministratore non può eliminare il suo account dall'app", async () => {
    const r = await elimina(tF, { password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: ids.trainer.id } })).not.toBeNull();
  });

  it('un trainer con clienti collegati non può eliminarsi', async () => {
    const tM = await token('marta@test.com');
    const r = await elimina(tM, { password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(409);
    expect(r.body.errore).toMatch(/1 cliente collegato/);
    expect(await prisma.user.findUnique({ where: { id: ids.marta.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: ids.paolo.id } })).not.toBeNull();
  });

  it('un trainer senza clienti si elimina, con la sua libreria e i suoi inviti', async () => {
    const luca = await creaUtente('Luca', 'luca@test.com', 'TRAINER');
    // Si era registrato con un invito trainer di Felice.
    const invitoTrainer = await prisma.invito.create({
      data: { codice: 'ABCD-EFGH', ruolo: 'TRAINER', trainerId: ids.trainer.id, scadeIl: new Date(Date.now() + 864e5), usatoIl: new Date(), usatoDaId: luca.id },
    });
    const tL = await token('luca@test.com');
    await api().post('/inviti').set(auth(tL)).send({ nota: 'Futuro cliente' });
    await prisma.esercizioPreset.create({ data: { nome: 'Panca', trainerId: luca.id } });

    const r = await elimina(tL, { password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: luca.id } })).toBeNull();
    expect(await prisma.invito.count({ where: { trainerId: luca.id } })).toBe(0);
    expect(await prisma.esercizioPreset.count({ where: { trainerId: luca.id } })).toBe(0);
    expect((await prisma.invito.findUnique({ where: { id: invitoTrainer.id } }))?.usatoDaId).toBeNull();
    // Felice e i suoi clienti non sono toccati.
    expect(await prisma.user.count({ where: { trainerId: ids.trainer.id } })).toBe(2);
  });

  it("un cliente con password temporanea non può eliminare l'account prima di cambiarla", async () => {
    await prisma.user.update({ where: { id: ids.giulia.id }, data: { passwordTemporanea: true } });
    const r = await elimina(tG, { password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: ids.giulia.id } })).not.toBeNull();
  });
});
