-- DropForeignKey
ALTER TABLE "Esercizio" DROP CONSTRAINT "Esercizio_schedaId_fkey";

-- DropForeignKey
ALTER TABLE "RegistroAllenamento" DROP CONSTRAINT "RegistroAllenamento_esercizioId_fkey";

-- AddForeignKey
ALTER TABLE "Esercizio" ADD CONSTRAINT "Esercizio_schedaId_fkey" FOREIGN KEY ("schedaId") REFERENCES "Scheda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAllenamento" ADD CONSTRAINT "RegistroAllenamento_esercizioId_fkey" FOREIGN KEY ("esercizioId") REFERENCES "Esercizio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
