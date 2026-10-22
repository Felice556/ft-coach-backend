-- "Avvisami" sui programmi Liftio in arrivo. Solo una tabella nuova: nessun dato esistente viene toccato.

-- CreateTable
CREATE TABLE "AvvisoProgramma" (
    "id" SERIAL NOT NULL,
    "programma" TEXT NOT NULL,
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "AvvisoProgramma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvvisoProgramma_userId_programma_key" ON "AvvisoProgramma"("userId", "programma");

-- AddForeignKey
ALTER TABLE "AvvisoProgramma" ADD CONSTRAINT "AvvisoProgramma_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
