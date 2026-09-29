import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, inizioGiornata, prisma, schedaDiProva, token, utentiDiPartenza } from './aiuti';

let ids: Awaited<ReturnType<typeof utentiDiPartenza>>;
let tF: string, tA: string, tG: string;

// Stato condiviso tra i test di questo file (girano in ordine).
let scheda: { id: number; esercizi: { id: number; nome: string }[] };
let pull: { id: number };
let superserie: { id: number };
let seriePull: { id: number };
let sessione: { id: number };

beforeAll(async () => {
  ids = await utentiDiPartenza();
  [tF, tA, tG] = await Promise.all([token('felice@test.com'), token('alessio@test.com'), token('giulia@test.com')]);
});

describe('Schede', () => {
  it('il trainer crea una scheda con range di ripetizioni, "Max", serie aggiunte e recupero 0', async () => {
    const r = await api()
      .post('/schede')
      .set(auth(tF))
      .send({
        nome: 'Test Push',
        clienteId: ids.alessio.id,
        esercizi: [
          {
            nome: 'Pulldown',
            serieTarget: 2,
            repsTarget: 6,
            repsMax: 9,
            recuperoSecondi: 150,
            descrizione: 'terza serie scala 30%',
            serieExtra: [{ reps: null, repsMax: null, recuperoSecondi: 60, nota: 'Dropset' }],
          },
          { nome: 'Superserie A', serieTarget: 3, repsTarget: null, recuperoSecondi: 0, videoUrl: 'https://youtube.com/x' },
        ],
      });
    expect(r.status).toBe(201);
    scheda = r.body;
    [pull, superserie] = r.body.esercizi;
    expect(r.body.esercizi[0]).toMatchObject({ repsTarget: 6, repsMax: 9 });
    expect(r.body.esercizi[0].serieExtra[0].reps).toBeNull();
  });

  it('non si assegna una scheda a un trainer, e un cliente non crea schede', async () => {
    const aTrainer = schedaDiProva(ids.trainer.id);
    expect((await api().post('/schede').set(auth(tF)).send(aTrainer)).status).toBe(400);
    expect((await api().post('/schede').set(auth(tA)).send(schedaDiProva(ids.alessio.id))).status).toBe(403);
  });

  it('ogni cliente vede solo le proprie schede', async () => {
    const diAlessio = (await api().get('/schede').set(auth(tA))).body;
    const diGiulia = (await api().get('/schede').set(auth(tG))).body;
    expect(diAlessio.some((s: { id: number }) => s.id === scheda.id)).toBe(true);
    expect(diGiulia.some((s: { id: number }) => s.id === scheda.id)).toBe(false);
  });

  it('valori assurdi rifiutati: nome lunghissimo, 500 serie, link video pericolosi', async () => {
    const lungo = { ...schedaDiProva(ids.giulia.id), nome: 'x'.repeat(500) };
    expect((await api().post('/schede').set(auth(tF)).send(lungo)).status).toBe(400);
    const troppe = schedaDiProva(ids.giulia.id, [{ nome: 'x', serieTarget: 500, repsTarget: 5, recuperoSecondi: 60 }]);
    expect((await api().post('/schede').set(auth(tF)).send(troppe)).status).toBe(400);
    for (const link of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const conLink = schedaDiProva(ids.giulia.id, [{ nome: 'x', videoUrl: link, serieTarget: 1, repsTarget: 5, recuperoSecondi: 60 }]);
      expect((await api().post('/schede').set(auth(tF)).send(conLink)).status).toBe(400);
    }
    const libreria = await api().post('/preset-esercizi').set(auth(tF)).send({ nome: 'Squat bulgaro', videoUrl: 'javascript:alert(1)' });
    expect(libreria.status).toBe(400);
  });
});

describe('Registrazione delle serie', () => {
  it('il cliente registra le sue serie (anche a corpo libero, con una nota)', async () => {
    expect((await api().post('/registro').set(auth(tA)).send({ esercizioId: superserie.id, pesoUsato: 0, repsFatte: 12 })).status).toBe(201);
    const r = await api().post('/registro').set(auth(tA)).send({ esercizioId: pull.id, pesoUsato: 50, repsFatte: 8, nota: 'ok' });
    expect(r.status).toBe(201);
    seriePull = r.body;
  });

  it('un altro cliente non può registrare, modificare, cancellare o leggere le serie di Alessio', async () => {
    expect((await api().post('/registro').set(auth(tG)).send({ esercizioId: pull.id, pesoUsato: 50, repsFatte: 8 })).status).toBe(404);
    expect((await api().put(`/registro/serie/${seriePull.id}`).set(auth(tG)).send({ pesoUsato: 1, repsFatte: 1 })).status).toBe(404);
    expect((await api().delete(`/registro/serie/${seriePull.id}`).set(auth(tG))).status).toBe(404);
    expect((await api().get(`/registro/${pull.id}`).set(auth(tG))).status).toBe(403);
  });

  it('il cliente corregge una sua serie; pesi assurdi rifiutati', async () => {
    const r = await api().put(`/registro/serie/${seriePull.id}`).set(auth(tA)).send({ pesoUsato: 52.5, repsFatte: 9 });
    expect(r.status).toBe(200);
    expect(r.body.pesoUsato).toBe(52.5);
    expect((await api().post('/registro').set(auth(tA)).send({ esercizioId: pull.id, pesoUsato: 6000, repsFatte: 8 })).status).toBe(400);
  });
});

describe('Allenamento completato', () => {
  it('conta le serie fatte su quelle previste (serie aggiunte comprese)', async () => {
    const r = await api().post('/sessioni').set(auth(tA)).send({ schedaId: scheda.id, inizioGiornata: inizioGiornata() });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ serieFatte: 2, serieTotali: 6 });
    sessione = r.body;
  });

  it('un secondo "completato" nello stesso giorno aggiorna, non duplica', async () => {
    await api().post('/registro').set(auth(tA)).send({ esercizioId: superserie.id, pesoUsato: 0, repsFatte: 10 });
    const r = await api().post('/sessioni').set(auth(tA)).send({ schedaId: scheda.id, inizioGiornata: inizioGiornata() });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(sessione.id);
    expect(r.body.serieFatte).toBe(3);
  });

  it('nessuno chiude la scheda di un altro, né un giorno di 5 giorni fa', async () => {
    expect((await api().post('/sessioni').set(auth(tG)).send({ schedaId: scheda.id, inizioGiornata: inizioGiornata() })).status).toBe(404);
    const vecchio = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect((await api().post('/sessioni').set(auth(tA)).send({ schedaId: scheda.id, inizioGiornata: vecchio })).status).toBe(400);
  });

  it('il trainer vede gli allenamenti con nome del cliente e della scheda', async () => {
    const r = await api().get('/sessioni').set(auth(tF));
    expect(r.status).toBe(200);
    expect(r.body[0].cliente.nome).toBeTruthy();
    expect(r.body[0].scheda.nome).toBeTruthy();
  });
});

describe('I dati dei clienti non si perdono mai', () => {
  it('togliere un esercizio con storico lo ARCHIVIA: nessuna serie persa', async () => {
    const seriePrima = await prisma.registroAllenamento.count({ where: { clienteId: ids.alessio.id } });
    const r = await api()
      .put(`/schede/${scheda.id}`)
      .set(auth(tF))
      .send({
        nome: 'Test Push v2',
        clienteId: ids.alessio.id,
        esercizi: [{ id: superserie.id, nome: 'Superserie A', serieTarget: 3, repsTarget: 15, recuperoSecondi: 0, serieExtra: [] }],
      });
    expect(r.status).toBe(200);
    expect(r.body.esercizi).toHaveLength(1);
    expect((await prisma.esercizio.findUnique({ where: { id: pull.id } }))?.archiviatoIl).not.toBeNull();
    expect(await prisma.registroAllenamento.count({ where: { clienteId: ids.alessio.id } })).toBe(seriePrima);
  });

  it('su un esercizio archiviato non si registra, ma lo storico resta leggibile', async () => {
    expect((await api().post('/registro').set(auth(tA)).send({ esercizioId: pull.id, pesoUsato: 50, repsFatte: 8 })).status).toBe(400);
    const r = await api().get(`/registro/${pull.id}`).set(auth(tA));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it('una scheda con storico non si sposta a un altro cliente', async () => {
    expect((await api().put(`/schede/${scheda.id}`).set(auth(tF)).send({ nome: 'Spostata', clienteId: ids.giulia.id })).status).toBe(409);
  });

  it('archivio schede: il cliente non la vede più, non si elimina finché ha storico, si ripristina', async () => {
    expect((await api().delete(`/schede/${scheda.id}`).set(auth(tF))).status).toBe(400); // prima va archiviata
    expect((await api().post(`/schede/${scheda.id}/archivia`).set(auth(tF))).status).toBe(204);
    expect((await api().get('/schede').set(auth(tA))).body.some((s: { id: number }) => s.id === scheda.id)).toBe(false);

    const archivio = (await api().get('/schede?archiviate=1').set(auth(tF))).body;
    expect(archivio.find((s: { id: number }) => s.id === scheda.id)?.haStorico).toBe(true);
    expect((await api().delete(`/schede/${scheda.id}`).set(auth(tF))).status).toBe(409);

    expect((await api().post(`/schede/${scheda.id}/ripristina`).set(auth(tF))).status).toBe(204);
    expect((await api().get('/schede').set(auth(tA))).body.some((s: { id: number }) => s.id === scheda.id)).toBe(true);
  });

  it('una scheda vuota creata per sbaglio, archiviata, si può eliminare davvero', async () => {
    const sbagliata = (await api().post('/schede').set(auth(tF)).send(schedaDiProva(ids.giulia.id))).body;
    await api().post(`/schede/${sbagliata.id}/archivia`).set(auth(tF));
    expect((await api().delete(`/schede/${sbagliata.id}`).set(auth(tF))).status).toBe(204);
    expect(await prisma.scheda.count({ where: { id: sbagliata.id } })).toBe(0);
  });

  it('un allenamento concluso non si può cancellare', async () => {
    expect((await api().delete(`/sessioni/${sessione.id}`).set(auth(tA))).status).toBe(404);
    expect(await prisma.sessioneAllenamento.count({ where: { id: sessione.id } })).toBe(1);
  });

  it('il trainer rivede e ripristina gli esercizi tolti, con tutto il loro storico', async () => {
    const tolti = await api().get(`/schede/${scheda.id}/esercizi-archiviati`).set(auth(tF));
    expect(tolti.status).toBe(200);
    expect(tolti.body.find((e: { id: number }) => e.id === pull.id)._count.registri).toBeGreaterThan(0);
    expect((await api().get(`/schede/${scheda.id}/esercizi-archiviati`).set(auth(tA))).status).toBe(403);

    expect((await api().post(`/esercizi/${pull.id}/ripristina`).set(auth(tF))).status).toBe(204);
    const schede = (await api().get('/schede').set(auth(tA))).body;
    expect(schede.find((s: { id: number }) => s.id === scheda.id).esercizi.some((e: { id: number }) => e.id === pull.id)).toBe(true);
    expect((await api().post(`/esercizi/${pull.id}/ripristina`).set(auth(tF))).status).toBe(404);
  });
});

describe('Storico di una scheda per il trainer', () => {
  it('mostra ogni serie del cliente, in ordine, anche degli esercizi tolti; mai le password', async () => {
    // Un esercizio tolto SENZA serie non deve comparire
    const conVuoto = await api()
      .put(`/schede/${scheda.id}`)
      .set(auth(tF))
      .send({
        nome: 'Test Push v3',
        clienteId: ids.alessio.id,
        esercizi: [
          { id: pull.id, nome: 'Pulldown', serieTarget: 2, repsTarget: 6, recuperoSecondi: 150, serieExtra: [] },
          { id: superserie.id, nome: 'Superserie A', serieTarget: 3, repsTarget: 15, recuperoSecondi: 0, serieExtra: [] },
          { nome: 'Vuoto', serieTarget: 1, repsTarget: 5, recuperoSecondi: 60, serieExtra: [] },
        ],
      });
    expect(conVuoto.status).toBe(200);
    await api()
      .put(`/schede/${scheda.id}`)
      .set(auth(tF))
      .send({
        nome: 'Test Push v3',
        clienteId: ids.alessio.id,
        esercizi: [
          { id: pull.id, nome: 'Pulldown', serieTarget: 2, repsTarget: 6, recuperoSecondi: 150, serieExtra: [] },
          { id: superserie.id, nome: 'Superserie A', serieTarget: 3, repsTarget: 15, recuperoSecondi: 0, serieExtra: [] },
        ],
      });
    await api().post('/registro').set(auth(tA)).send({ esercizioId: pull.id, pesoUsato: 55, repsFatte: 7 });

    const r = await api().get(`/schede/${scheda.id}/storico`).set(auth(tF));
    expect(r.status).toBe(200);
    expect(r.body.cliente.nome).toBe('Alessio');
    const nomi = r.body.esercizi.map((e: { nome: string }) => e.nome);
    expect(nomi).toContain('Pulldown');
    expect(nomi).not.toContain('Vuoto');
    const serie = r.body.esercizi.find((e: { nome: string }) => e.nome === 'Pulldown').registri;
    expect(serie.length).toBe(2);
    expect(serie.every((s: { clienteId: number }) => s.clienteId === ids.alessio.id)).toBe(true);
    expect(new Date(serie[0].data).getTime()).toBeLessThanOrEqual(new Date(serie[1].data).getTime());
    expect(JSON.stringify(r.body)).not.toContain('password');
  });

  it('solo il trainer; scheda inesistente 404; id non valido 400', async () => {
    expect((await api().get(`/schede/${scheda.id}/storico`).set(auth(tA))).status).toBe(403);
    expect((await api().get('/schede/99999/storico').set(auth(tF))).status).toBe(404);
    expect((await api().get('/schede/abc/storico').set(auth(tF))).status).toBe(400);
  });
});

describe('Robustezza e intestazioni di sicurezza', () => {
  it('id non numerici e JSON rotto → 400, mai un 500', async () => {
    expect((await api().get('/registro/abc').set(auth(tA))).status).toBe(400);
    expect((await api().get('/sessioni?clienteId=abc').set(auth(tF))).status).toBe(400);
    const rotto = await api().post('/schede').set(auth(tF)).set('Content-Type', 'application/json').send('{json rotto');
    expect(rotto.status).toBe(400);
    expect((await api().post('/preset-note').set(auth(tF)).send({ testo: '   ' })).status).toBe(400);
  });

  it('richieste enormi rifiutate (oltre 100 KB)', async () => {
    const enorme = { ...schedaDiProva(ids.giulia.id), descrizione: 'x'.repeat(200_000) };
    expect((await api().post('/schede').set(auth(tF)).send(enorme)).status).toBe(413);
  });

  it('intestazioni di sicurezza attive e server che non dice di essere Express', async () => {
    const r = await api().get('/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeTruthy();
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});
