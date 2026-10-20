import { Router } from 'express';
import { prisma } from '../prisma.js';
import { autentica, richiedeAdmin, richiedeRuolo } from '../middleware/auth.js';
import { leggiId } from '../utils.js';

const router = Router();

const GIORNO = 24 * 60 * 60 * 1000;

// Panoramica per l'amministratore: quanti trainer usano l'app e quanto la usano i loro clienti.
// Solo NUMERI: nessun nome o dato dei clienti degli altri trainer esce da qui.
router.get('/admin/trainer', autentica, richiedeAdmin, async (_req, res) => {
  const da30giorni = new Date(Date.now() - 30 * GIORNO);

  const trainer = await prisma.user.findMany({
    where: { ruolo: 'TRAINER', approvato: true }, // quelli in attesa stanno nella loro lista
    orderBy: { id: 'asc' },
    select: {
      id: true,
      nome: true,
      email: true,
      admin: true,
      sospeso: true,
      invitoUsato: { select: { usatoIl: true } }, // quando si è registrato (se con un invito trainer)
      _count: { select: { clienti: true } },
    },
  });

  const righe = await Promise.all(
    trainer.map(async (t) => {
      const deiSuoiClienti = { cliente: { trainerId: t.id } };
      const [clientiAttivi, schedeAttive, allenamenti30, ultimo] = await Promise.all([
        // clienti con almeno un allenamento concluso negli ultimi 30 giorni
        prisma.user.count({ where: { trainerId: t.id, sessioni: { some: { completataIl: { gte: da30giorni } } } } }),
        prisma.scheda.count({ where: { ...deiSuoiClienti, archiviataIl: null } }),
        prisma.sessioneAllenamento.count({ where: { ...deiSuoiClienti, completataIl: { gte: da30giorni } } }),
        prisma.sessioneAllenamento.findFirst({
          where: deiSuoiClienti,
          orderBy: { completataIl: 'desc' },
          select: { completataIl: true },
        }),
      ]);
      return {
        id: t.id,
        nome: t.nome,
        email: t.email,
        admin: t.admin,
        sospeso: t.sospeso,
        registratoIl: t.invitoUsato?.usatoIl ?? null,
        clienti: t._count.clienti,
        clientiAttivi,
        schedeAttive,
        allenamenti30,
        ultimoAllenamento: ultimo?.completataIl ?? null,
      };
    }),
  );

  res.json({
    totali: {
      trainer: righe.length,
      clienti: righe.reduce((s, r) => s + r.clienti, 0),
      clientiAttivi: righe.reduce((s, r) => s + r.clientiAttivi, 0),
      allenamenti30: righe.reduce((s, r) => s + r.allenamenti30, 0),
    },
    trainer: righe,
  });
});

// ---------- Sospendere / riattivare un trainer ----------
// Il trainer sospeso non può accedere, e nemmeno i suoi clienti. Nessun dato viene cancellato:
// riattivandolo torna tutto come prima. L'amministratore non può sospendere sé stesso.
for (const [azione, sospeso] of [['sospendi', true], ['riattiva', false]] as const) {
  router.post(`/admin/trainer/:id/${azione}`, autentica, richiedeRuolo('TRAINER'), richiedeAdmin, async (req, res) => {
    const id = leggiId(req.params.id, res);
    if (id === null) return;
    const { count } = await prisma.user.updateMany({
      where: { id, ruolo: 'TRAINER', approvato: true, admin: false },
      data: { sospeso, sospesoIl: sospeso ? new Date() : null },
    });
    if (count === 0) {
      res.status(404).json({ errore: 'Trainer non trovato' });
      return;
    }
    res.status(204).send();
  });
}

// ---------- Trainer in attesa di approvazione ----------
// Si sono registrati da soli (senza invito): solo l'amministratore può approvarli o rifiutarli.

router.get('/admin/trainer-in-attesa', autentica, richiedeAdmin, async (_req, res) => {
  const inAttesa = await prisma.user.findMany({
    where: { ruolo: 'TRAINER', approvato: false },
    orderBy: { richiestaIl: 'asc' }, // prima chi aspetta da più tempo
    select: { id: true, nome: true, email: true, presentazione: true, fasciaClienti: true, richiestaIl: true }, // mai la password
  });
  res.json(inAttesa);
});

router.post('/admin/trainer/:id/approva', autentica, richiedeAdmin, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  // updateMany con le condizioni: si approva solo un TRAINER davvero in attesa.
  const { count } = await prisma.user.updateMany({
    where: { id, ruolo: 'TRAINER', approvato: false },
    data: { approvato: true },
  });
  if (count === 0) {
    res.status(404).json({ errore: 'Richiesta non trovata (forse è già stata gestita)' });
    return;
  }
  res.status(204).send();
});

// Rifiutare = cancellare l'account in attesa. Non ha clienti né schede: finché era in attesa
// non poteva creare niente. Se ci riprova, l'amministratore vedrà una nuova richiesta.
router.post('/admin/trainer/:id/rifiuta', autentica, richiedeAdmin, async (req, res) => {
  const id = leggiId(req.params.id, res);
  if (id === null) return;
  const trainer = await prisma.user.findFirst({ where: { id, ruolo: 'TRAINER', approvato: false } });
  if (!trainer) {
    res.status(404).json({ errore: 'Richiesta non trovata (forse è già stata gestita)' });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.invito.deleteMany({ where: { trainerId: id } });
    await tx.invito.updateMany({ where: { usatoDaId: id }, data: { usatoDaId: null } });
    await tx.user.delete({ where: { id } });
  });
  res.status(204).send();
});

export default router;
