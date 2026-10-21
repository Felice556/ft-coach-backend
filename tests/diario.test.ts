// Diario alimentare: lo scrive il cliente (solo con il suo consenso), il trainer lo legge e commenta.
// Ritirando il consenso il diario si cancella. Nessun trainer vede il diario di clienti non suoi.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, prisma, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>> & Awaited<ReturnType<typeof altroTrainerConCliente>>;
let tF: string, tA: string, tM: string, tG: string;

const oggi = () => new Date().toISOString().slice(0, 10);
const ieri = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const giornata = {
  pasti: {
    COLAZIONE: { testo: 'Yogurt greco e avena', ora: '07:30' },
    PRANZO: { testo: 'Pasta al pomodoro, insalata' },
    CENA: { testo: '  ' }, // vuoto: non viene salvato
  },
  olioCucchiai: 2,
  acquaLitri: 1.5,
  sensazioni: 'Molta fame nel pomeriggio',
};

const consenso = (t: string, si = true) => api().put('/diario/consenso').set(auth(t)).send({ consenso: si });
const salva = (t: string, data: string, corpo: object) => api().put(`/diario/${data}`).set(auth(t)).send(corpo);

beforeEach(async () => {
  ids = { ...(await utentiDiPartenza()), ...(await altroTrainerConCliente()) };
  [tF, tA, tM, tG] = await Promise.all(['felice@test.com', 'alessio@test.com', 'marta@test.com', 'giulia@test.com'].map((e) => token(e)));
});

describe('Consenso', () => {
  it('senza consenso il diario non si può scrivere, e il trainer non vede niente', async () => {
    expect((await api().get('/diario').set(auth(tA))).body).toEqual({ consenso: false, giorni: [] });
    const r = await salva(tA, oggi(), giornata);
    expect(r.status).toBe(403);
    expect(r.body.errore).toBe('Per usare il diario serve il tuo consenso');
    expect((await api().get(`/diario?clienteId=${ids.alessio.id}`).set(auth(tF))).body.consenso).toBe(false);
  });

  it('ritirando il consenso il diario viene cancellato (pasti compresi)', async () => {
    await consenso(tA);
    await salva(tA, oggi(), giornata);
    await salva(tA, ieri(), { pasti: { CENA: { testo: 'Pizza' } } });
    expect(await prisma.pastoDiario.count()).toBe(3);
    expect((await consenso(tA, false)).body).toEqual({ consenso: false });
    expect(await prisma.giornoDiario.count({ where: { clienteId: ids.alessio.id } })).toBe(0);
    expect(await prisma.pastoDiario.count()).toBe(0);
    expect((await api().get('/diario').set(auth(tA))).body).toEqual({ consenso: false, giorni: [] });
  });

  it('il consenso lo dà solo il cliente', async () => {
    expect((await consenso(tF)).status).toBe(403);
  });
});

describe('Giornate del diario (cliente)', () => {
  beforeEach(async () => {
    await consenso(tA);
  });

  it('salva una giornata: i pasti vuoti non contano, olio e acqua arrotondati', async () => {
    const r = await salva(tA, oggi(), { ...giornata, olioCucchiai: 2.3, acquaLitri: 1.6 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ olioCucchiai: 2.5, acquaLitri: 1.5, sensazioni: 'Molta fame nel pomeriggio', commentoTrainer: null });
    expect(r.body.pasti).toEqual(
      expect.arrayContaining([
        { tipo: 'COLAZIONE', nome: null, testo: 'Yogurt greco e avena', ora: '07:30' },
        { tipo: 'PRANZO', nome: null, testo: 'Pasta al pomodoro, insalata', ora: null },
      ]),
    );
    expect(r.body.pasti).toHaveLength(2);
  });

  it('risalvando lo stesso giorno lo si corregge, senza duplicati', async () => {
    await salva(tA, oggi(), giornata);
    const r = await salva(tA, oggi(), { pasti: { PRANZO: { testo: 'Riso e pollo' } }, acquaLitri: 2 });
    expect(r.body.pasti).toEqual([{ tipo: 'PRANZO', nome: null, testo: 'Riso e pollo', ora: null }]);
    expect(r.body.olioCucchiai).toBeNull();
    expect(await prisma.giornoDiario.count({ where: { clienteId: ids.alessio.id } })).toBe(1);
  });

  it('una giornata svuotata sparisce', async () => {
    await salva(tA, oggi(), giornata);
    const r = await salva(tA, oggi(), { pasti: {} });
    expect(r.body).toBeNull();
    expect(await prisma.giornoDiario.count()).toBe(0);
  });

  it('niente giorni futuri, ore sbagliate o testi lunghissimi', async () => {
    const tra3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await salva(tA, tra3, giornata)).status).toBe(400);
    expect((await salva(tA, '2026-13-01', giornata)).status).toBe(400);
    expect((await salva(tA, oggi(), { pasti: { PRANZO: { testo: 'x', ora: '25:00' } } })).status).toBe(400);
    expect((await salva(tA, oggi(), { pasti: { PRANZO: { testo: 'x'.repeat(501) } } })).status).toBe(400);
    expect((await salva(tA, oggi(), { pasti: {}, olioCucchiai: 30 })).status).toBe(400);
    expect((await salva(tF, oggi(), giornata)).status).toBe(403); // il trainer non scrive il diario
  });
});

describe('Trainer: legge e commenta', () => {
  beforeEach(async () => {
    await consenso(tA);
    await salva(tA, oggi(), giornata);
  });

  it('il trainer legge il diario del suo cliente e commenta una giornata', async () => {
    const lettura = await api().get(`/diario?clienteId=${ids.alessio.id}`).set(auth(tF));
    expect(lettura.body.consenso).toBe(true);
    expect(lettura.body.giorni).toHaveLength(1);

    const c = await api().put(`/diario/${oggi()}/commento`).set(auth(tF)).send({ clienteId: ids.alessio.id, commento: 'Ottima costanza!' });
    expect(c.status).toBe(200);
    expect(c.body.commentoTrainer).toBe('Ottima costanza!');
    expect(c.body.commentatoIl).toBeTruthy();
    // Il cliente lo vede
    expect((await api().get('/diario').set(auth(tA))).body.giorni[0].commentoTrainer).toBe('Ottima costanza!');

    const tolto = await api().put(`/diario/${oggi()}/commento`).set(auth(tF)).send({ clienteId: ids.alessio.id, commento: '' });
    expect(tolto.body).toMatchObject({ commentoTrainer: null, commentatoIl: null });
  });

  it('il commento resta anche se il cliente svuota la giornata', async () => {
    await api().put(`/diario/${oggi()}/commento`).set(auth(tF)).send({ clienteId: ids.alessio.id, commento: 'Bravo' });
    const r = await salva(tA, oggi(), { pasti: {} });
    expect(r.body).toMatchObject({ commentoTrainer: 'Bravo', pasti: [] });
  });

  it('non si commenta un giorno non compilato', async () => {
    const r = await api().put(`/diario/${ieri()}/commento`).set(auth(tF)).send({ clienteId: ids.alessio.id, commento: 'Ciao' });
    expect(r.status).toBe(404);
  });

  it('un altro trainer non vede né commenta il diario di un cliente non suo', async () => {
    expect((await api().get(`/diario?clienteId=${ids.alessio.id}`).set(auth(tM))).status).toBe(404);
    expect((await api().put(`/diario/${oggi()}/commento`).set(auth(tM)).send({ clienteId: ids.alessio.id, commento: 'X' })).status).toBe(404);
    // E un cliente non commenta, né vede il diario di un altro cliente
    expect((await api().put(`/diario/${oggi()}/commento`).set(auth(tG)).send({ clienteId: ids.alessio.id, commento: 'X' })).status).toBe(403);
    const diGiulia = await api().get(`/diario?clienteId=${ids.alessio.id}`).set(auth(tG));
    expect(diGiulia.body).toEqual({ consenso: false, giorni: [] });
  });

  it('eliminando l’account del cliente si cancella anche il diario', async () => {
    const r = await api().delete('/me').set(auth(tA)).send({ password: 'password123', conferma: 'ELIMINA' });
    expect(r.status).toBe(204);
    expect(await prisma.giornoDiario.count()).toBe(0);
    expect(await prisma.pastoDiario.count()).toBe(0);
  });
});

describe('Voci in più', () => {
  beforeEach(async () => {
    await consenso(tA);
  });

  it('il cliente aggiunge voci con un nome suo, anche più d’una, nell’ordine scelto', async () => {
    const r = await salva(tA, oggi(), {
      pasti: { CENA: { testo: 'Pesce e verdure', ora: '20:00' } },
      extra: [
        { nome: 'Post cena', testo: 'Una tisana e due biscotti', ora: '22:30' },
        { nome: 'Spuntino', testo: '  ' }, // vuota: non viene salvata
        { nome: 'Pre allenamento', testo: 'Banana' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.pasti).toEqual([
      { tipo: 'CENA', nome: null, testo: 'Pesce e verdure', ora: '20:00' },
      { tipo: 'EXTRA', nome: 'Post cena', testo: 'Una tisana e due biscotti', ora: '22:30' },
      { tipo: 'EXTRA', nome: 'Pre allenamento', testo: 'Banana', ora: null },
    ]);
    // Il trainer le vede uguali
    const delTrainer = await api().get(`/diario?clienteId=${ids.alessio.id}`).set(auth(tF));
    expect(delTrainer.body.giorni[0].pasti).toHaveLength(3);
  });

  it('una giornata con solo voci in più non è vuota; risalvando si sostituiscono', async () => {
    await salva(tA, oggi(), { pasti: {}, extra: [{ nome: 'Post cena', testo: 'Yogurt' }] });
    const r = await salva(tA, oggi(), { pasti: {}, extra: [{ nome: 'Spuntino', testo: 'Mela' }] });
    expect(r.body.pasti).toEqual([{ tipo: 'EXTRA', nome: 'Spuntino', testo: 'Mela', ora: null }]);
    expect(await prisma.pastoDiario.count()).toBe(1);
  });

  it('serve un nome, al massimo 40 caratteri e al massimo 6 voci', async () => {
    expect((await salva(tA, oggi(), { pasti: {}, extra: [{ nome: '', testo: 'x' }] })).status).toBe(400);
    expect((await salva(tA, oggi(), { pasti: {}, extra: [{ nome: 'x'.repeat(41), testo: 'x' }] })).status).toBe(400);
    const sette = Array.from({ length: 7 }, (_, i) => ({ nome: `Voce ${i}`, testo: 'x' }));
    const r = await salva(tA, oggi(), { pasti: {}, extra: sette });
    expect(r.status).toBe(400);
  });
});
