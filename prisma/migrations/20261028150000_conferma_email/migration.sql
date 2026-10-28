-- Conferma dell'email dopo l'iscrizione. Una colonna nuova (vuota) e una tabella nuova:
-- nessun dato esistente viene cancellato o cambiato, tranne segnare come già confermati
-- gli account che esistevano prima di questa funzione (così non vedono nessun avviso).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailConfermataIl" TIMESTAMP(3);

-- Account esistenti: già confermati
UPDATE "User" SET "emailConfermataIl" = CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ConfermaEmail" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "scadeIl" TIMESTAMP(3) NOT NULL,
    "usatoIl" TIMESTAMP(3),
    "creatoIl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "ConfermaEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfermaEmail_tokenHash_key" ON "ConfermaEmail"("tokenHash");

-- CreateIndex
CREATE INDEX "ConfermaEmail_userId_idx" ON "ConfermaEmail"("userId");

-- AddForeignKey
ALTER TABLE "ConfermaEmail" ADD CONSTRAINT "ConfermaEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
