-- CreateTable
CREATE TABLE "SerieExtra" (
    "id" SERIAL NOT NULL,
    "ordine" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "recuperoSecondi" INTEGER NOT NULL,
    "nota" TEXT,
    "esercizioId" INTEGER NOT NULL,

    CONSTRAINT "SerieExtra_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SerieExtra" ADD CONSTRAINT "SerieExtra_esercizioId_fkey" FOREIGN KEY ("esercizioId") REFERENCES "Esercizio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
