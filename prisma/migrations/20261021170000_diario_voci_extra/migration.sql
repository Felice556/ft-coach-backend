-- Diario: il cliente può aggiungere voci in più con un nome suo (es. "Post cena").
-- Un valore nuovo nel tipo, due colonne nuove e un indice al posto del vincolo "un pasto per tipo"
-- (per i 5 pasti fissi lo controlla il server). Nessun dato esistente viene modificato o cancellato.
-- AlterEnum
ALTER TYPE "TipoPasto" ADD VALUE 'EXTRA';

-- DropIndex
DROP INDEX "PastoDiario_giornoId_tipo_key";

-- AlterTable
ALTER TABLE "PastoDiario" ADD COLUMN     "nome" TEXT,
ADD COLUMN     "ordine" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "PastoDiario_giornoId_idx" ON "PastoDiario"("giornoId");
