import { Prisma } from "../../generated/prisma/client";
import { prismaClient } from "../lib/prisma";

type RegisterType = "phone" | "email";

export const getUserByValue = async (value: string, type: RegisterType) => {
  return await prismaClient.user.findUnique({
    where:
      type === "phone"
        ? { phone: value }
        : { email: value },
  });
}

export const getOtpByValue = async (recipient: string) => {
  return await prismaClient.otp.findUnique({
    where: { recipient },
  })
}

export const createOtp = async (otpData: Prisma.OtpCreateInput) => {
  return await prismaClient.otp.create({
    data: otpData,
  })
}

export const updateOtp = async(id: number,otpData: any) => {
  return await prismaClient.otp.update({
    where: { id },
    data: otpData
  })
}