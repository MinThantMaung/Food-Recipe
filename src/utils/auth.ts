import { errorCode } from "../../config/error";
import { Prisma } from "../../generated/prisma/client";

export const checkUserIfExist = (user : Prisma.UserCreateInput | null) => {
  if (user) {
    const error: any = new Error("User does not exist");
    error.status = 404;
    error.code = errorCode.notfound;
    throw error;
  }
}

export const checkOtpExist = (otpRow : any) => {
  if (!otpRow) {
    const error: any = new Error("Invalid verification code or verification code has expired");
    error.status = 400;
    error.code = "invalidOtp";
    throw error;
  }
}

export const checkOtpErrorIfSameDate = (
  isSameDate: boolean,
  errorCount: number
) => {
  if (isSameDate && errorCount === 5) {
    const error: any = new Error(
      "You have reached the maximum number of OTP requests for today. Please try again tomorrow."
    );
    error.status = 401;
    error.code = "overLimit";
    throw error;
  }
};