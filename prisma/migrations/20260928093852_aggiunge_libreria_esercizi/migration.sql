-- CreateTable
CREATE TABLE "EsercizioPreset" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "videoUrl" TEXT,
    "descrizione" TEXT,
    "trainerId" INTEGER NOT NULL,

    CONSTRAINT "EsercizioPreset_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EsercizioPreset" ADD CONSTRAINT "EsercizioPreset_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
