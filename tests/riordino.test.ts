// Ordine degli esercizi: il trainer li trascina nel form e salva; l'ordine nuovo vale per tutti
// (anche per il cliente) e gli esercizi spostati tengono il loro storico.
import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, creaUtente, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let tF: string, tA: string;
let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;

beforeEach(async () => {
  ids = await utentiDiPartenza();
  [tF, tA] = await Promise.all(['felice@test.com', 'alessio@test.com'].map((e) => token(e)));
});

const tre = [
  { nome: 'Panca piana', serieTarget: 3, repsTarget: 8, recuperoSecondi: 120 },
  { nome: 'Croci', serieTarget: 3, repsTarget: 12, recuperoSecondi: 60 },
  { nome: 'Dip', serieTarget: 3, repsTarget: null, recuperoSecondi: 90 },
];
const nomi = (s: { esercizi: { nome: string }[] }) => s.esercizi.map((e) => e.nome);
// Rimanda un esercizio così com'è (con il suo id), come fa il form.
const comE = (e: any) => ({ id: e.id, nome: e.nome, serieTarget: e.serieTarget, repsTarget: e.repsTarget, recuperoSecondi: e.recuperoSecondi });

describe('Riordino degli esercizi', () => {
  it('salvando la scheda con gli esercizi in un altro ordine, l’ordine resta: per il trainer e per il cliente', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, tre))).body;
    expect(nomi(s)).toEqual(['Panca piana', 'Croci', 'Dip']);
    const [panca, croci, dip] = s.esercizi;

    const r = await api().put(`/schede/${s.id}`).set(auth(tF)).send({ nome: s.nome, esercizi: [dip, panca, croci].map(comE) });
    expect(r.status).toBe(200);
    expect(nomi(r.body)).toEqual(['Dip', 'Panca piana', 'Croci']);
    // Stessi esercizi (stessi id), solo spostati
    expect(r.body.esercizi.map((e: any) => e.id)).toEqual([dip.id, panca.id, croci.id]);

    const delCliente = (await api().get('/schede').set(auth(tA))).body.find((x: any) => x.id === s.id);
    expect(nomi(delCliente)).toEqual(['Dip', 'Panca piana', 'Croci']);
  });

  it('spostando un esercizio, le serie che il cliente aveva già registrato restano sue', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, tre))).body;
    const [panca, croci, dip] = s.esercizi;
    expect((await api().post('/registro').set(auth(tA)).send({ esercizioId: panca.id, pesoUsato: 60, repsFatte: 8 })).status).toBe(201);

    await api().put(`/schede/${s.id}`).set(auth(tF)).send({ nome: s.nome, esercizi: [croci, dip, panca].map(comE) });
    const storico = (await api().get(`/schede/${s.id}/storico`).set(auth(tF))).body;
    expect(nomi(storico)).toEqual(['Croci', 'Dip', 'Panca piana']);
    expect(storico.esercizi[2].registri).toHaveLength(1);
    expect(storico.esercizi[2].registri[0].pesoUsato).toBe(60);
  });

  it('un esercizio nuovo si può mettere in mezzo, e uno rimesso dopo essere stato tolto torna in fondo', async () => {
    const s = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.alessio.id, tre))).body;
    const [panca, croci, dip] = s.esercizi;
    const r = await api().put(`/schede/${s.id}`).set(auth(tF)).send({
      nome: s.nome,
      esercizi: [comE(panca), { nome: 'Pectoral machine', serieTarget: 3, repsTarget: 10, recuperoSecondi: 90 }, comE(dip)], // Croci tolto
    });
    expect(nomi(r.body)).toEqual(['Panca piana', 'Pectoral machine', 'Dip']);

    expect((await api().post(`/esercizi/${croci.id}/ripristina`).set(auth(tF))).status).toBe(204);
    const dopo = (await api().get('/schede').set(auth(tA))).body.find((x: any) => x.id === s.id);
    expect(nomi(dopo)).toEqual(['Panca piana', 'Pectoral machine', 'Dip', 'Croci']);
  });

  it('chi si allena da solo riordina le sue schede allo stesso modo', async () => {
    await creaUtente('Sara', 'sara@test.com', 'CLIENTE');
    const tS = await token('sara@test.com');
    const s = (await api().post('/schede').set(auth(tS)).send({ nome: 'Giorno A', esercizi: tre })).body;
    expect(s.esercizi).toHaveLength(3);
    const [panca, croci, dip] = s.esercizi;
    const r = await api().put(`/schede/${s.id}`).set(auth(tS)).send({ nome: s.nome, esercizi: [croci, panca, dip].map(comE) });
    expect(r.status).toBe(200);
    expect(nomi(r.body)).toEqual(['Croci', 'Panca piana', 'Dip']);
  });
});
