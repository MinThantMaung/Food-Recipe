/*
  Warnings:

  - A unique constraint covering the columns `[recipient]` on the table `Otp` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Otp_recipient_key" ON "Otp"("recipient");
