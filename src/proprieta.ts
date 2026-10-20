// Chi può vedere cosa: ogni trainer vede SOLO i propri clienti e i loro dati.
// Tutte le rotte del trainer passano da qui, così la regola è scritta in un posto solo.
import { prisma } from './prisma.js';

// Il cliente con questo id, solo se è un CLIENTE seguito da questo trainer (altrimenti null).
export function clienteDelTrainer(trainerId: number, clienteId: number) {
  return prisma.user.findFirst({ where: { id: clienteId, ruolo: 'CLIENTE', trainerId } });
}

// Filtro Prisma: "schede dei clienti di questo trainer".
export const schedeDelTrainer = (trainerId: number) => ({ cliente: { trainerId } });

// Filtro Prisma: "esercizi delle schede dei clienti di questo trainer".
export const eserciziDelTrainer = (trainerId: number) => ({ scheda: { cliente: { trainerId } } });
