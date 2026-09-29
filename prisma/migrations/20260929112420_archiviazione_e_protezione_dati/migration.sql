-- DropForeignKey
ALTER TABLE "RegistroAllenamento" DROP CONSTRAINT "RegistroAllenamento_esercizioId_fkey";

-- DropForeignKey
ALTER TABLE "SessioneAllenamento" DROP CONSTRAINT "SessioneAllenamento_schedaId_fkey";

-- AlterTable
ALTER TABLE "Esercizio" ADD COLUMN     "archiviatoIl" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Scheda" ADD COLUMN     "archiviataIl" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "SessioneAllenamento" ADD CONSTRAINT "SessioneAllenamento_schedaId_fkey" FOREIGN KEY ("schedaId") REFERENCES "Scheda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAllenamento" ADD CONSTRAINT "RegistroAllenamento_esercizioId_fkey" FOREIGN KEY ("esercizioId") REFERENCES "Esercizio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
