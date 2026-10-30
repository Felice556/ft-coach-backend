// Storico pesi generale: tutte le serie del cliente, su tutte le schede, con il nome
// dell'esercizio e della scheda (l'app le raggruppa per nome). Lo storico della singola scheda resta com'era.
import { beforeEach, describe, expect, it } from 'vitest';
import { altroTrainerConCliente, api, auth, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let tF: string, tA: string;
let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;

beforeEach(async () => {
  ids = await utentiDiPartenza();
  [tF, tA] = await Promise.all(['felice@test.com', 'alessio@test.com'].map((e) => token(e)));
});

async function serieSu(schedaNome: string, esercizio: string, peso: number) {
  const s = (await api().post('/schede').set(auth(tF)).send({ ...schedaDiProva(ids.alessio.id, [{ nome: esercizio, serieTarget: 3, repsTarget: 8, recuperoSecondi: 90 }]), nome: schedaNome })).body;
  expect((await api().post('/registro').set(auth(tA)).send({ esercizioId: s.esercizi[0].id, pesoUsato: peso, repsFatte: 8 })).status).toBe(201);
  return s;
}

describe('Storico pesi generale', () => {
  it('il cliente vede le serie di tutte le schede, anche archiviate, con nome esercizio e scheda', async () => {
    const vecchia = await serieSu('Giorno A - settembre', 'Panca piana', 60);
    await serieSu('Giorno A - ottobre', 'Panca Piana ', 65);
    expect((await api().post(`/schede/${vecchia.id}/archivia`).set(auth(tF))).status).toBeLessThan(300);

    const r = await api().get('/storico-pesi').set(auth(tA));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body.map((x: any) => [x.nomeEsercizio, x.nomeScheda, x.pesoUsato])).toEqual([
      ['Panca piana', 'Giorno A - settembre', 60],
      ['Panca Piana', 'Giorno A - ottobre', 65],
    ]);
    // Lo storico della singola scheda non cambia
    expect((await api().get(`/registro/${vecchia.esercizi[0].id}`).set(auth(tA))).body).toHaveLength(1);
  });

  it('il trainer lo vede per un suo cliente; un altro trainer no; senza cliente è un errore', async () => {
    await serieSu('Giorno A', 'Squat', 100);
    const r = await api().get(`/storico-pesi?clienteId=${ids.alessio.id}`).set(auth(tF));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect((await api().get('/storico-pesi').set(auth(tF))).status).toBe(400);

    const altro = await altroTrainerConCliente();
    const tAltro = await token(altro.marta.email);
    expect((await api().get(`/storico-pesi?clienteId=${ids.alessio.id}`).set(auth(tAltro))).status).toBe(404);
  });

  it('un cliente vede solo le sue serie', async () => {
    await serieSu('Giorno A', 'Squat', 100);
    const altro = await altroTrainerConCliente();
    const tC = await token(altro.paolo.email);
    expect((await api().get('/storico-pesi').set(auth(tC))).body).toEqual([]);
  });
});
