-- CreateTable
CREATE TABLE "NotaPreset" (
    "id" SERIAL NOT NULL,
    "testo" TEXT NOT NULL,
    "trainerId" INTEGER NOT NULL,

    CONSTRAINT "NotaPreset_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "NotaPreset" ADD CONSTRAINT "NotaPreset_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
