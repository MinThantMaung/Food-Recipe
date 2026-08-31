import { Request, Response, NextFunction } from "express";
import { body, check, validationResult } from "express-validator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import moment from "moment";
import "dotenv/config";
import { createError } from "../utils/error";
import { errorCode } from "../../config/error";
import {
  createOtp,
  getOtpByValue,
  getUserByValue,
  updateOtp,
} from "../services/authServices";
import {
  checkOtpErrorIfSameDate,
  checkOtpExist,
  checkUserIfExist,
} from "../utils/auth";
import { generateToken } from "../utils/generate";
import { Prisma } from "../../generated/prisma/client";

export const register = [
  body("type", "Invalid registration type")
    .trim()
    .notEmpty()
    .isIn(["phone", "email"])
    .withMessage("Registration type must be either phone or email"),
  body("value").trim().notEmpty().withMessage("Value is required"),
  body("value")
    .if((value, { req }) => req.body.type === "phone")
    .matches(/^[0-9]+$/)
    .withMessage("Phone number must contain only digits")
    .isLength({ min: 5, max: 12 })
    .withMessage("Phone number must be between 5 and 12 digits"),
  body("value")
    .if((value, { req }) => req.body.type === "email")
    .isEmail()
    .withMessage("Invalid email address"),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req).array({ onlyFirstError: true });
    if (errors.length > 0) {
      return next(createError(errors[0].msg, 400, errorCode.invalid));
    }

    //get req body
    const { type, value } = req.body;

    //check user is exist or not
    const user = await getUserByValue(value, type);
    checkUserIfExist(user);

    const otpCode = 12345; // implement later
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otpCode.toString(), salt);
    const token = generateToken();
    let result;

    const otprow = await getOtpByValue(value);
    if (!otprow) {
      const otpData: Prisma.OtpCreateInput = {
        recipient: value,
        otpCode: hashedOtp,
        rememberToken: token,
        purpose: "REGISTER",
        channel: type.toUpperCase(),
      };
      result = await createOtp(otpData);
    } else {
      const lastOtpRequest = new Date(otprow.updatedAt).toLocaleDateString();
      const today = new Date().toLocaleDateString();
      const isSameDay = lastOtpRequest === today;
      checkOtpErrorIfSameDate(isSameDay, otprow.attemptCount);
      if (!isSameDay) {
        const otpData: any = {
          otpCode: hashedOtp,
          rememberToken: token,
          attemptCount: 1,
          requestError: 0,
        };
        result = await updateOtp(otprow.id, otpData);
      } else {
        if (otprow.attemptCount === 5) {
          return next(
            createError(
              "You have reached the maximum number of OTP requests for today. Please try again tomorrow.",
              400,
              errorCode.overLimit
            )
          );
        } else {
          const otpData: any = {
            otpCode: hashedOtp,
            rememberToken: token,
            attemptCount: {
              increment: 1,
            },
          };
          result = await updateOtp(otprow.id, otpData);
        }
      }
    }

    res.status(200).json({
      message: `OTP  successfully sent to ${value}!`,
      value: result.recipient,
      token: result.rememberToken,
    });
  },
];

export const verifyOtp = [
  body("type", "Invalid registration type")
    .trim()
    .notEmpty()
    .isIn(["phone", "email"])
    .withMessage("Registration type must be either phone or email"),
  body("value").trim().notEmpty().withMessage("Value is required"),
  body("value")
    .if((value, { req }) => req.body.type === "phone")
    .matches(/^[0-9]+$/)
    .withMessage("Phone number must contain only digits")
    .isLength({ min: 5, max: 12 })
    .withMessage("Phone number must be between 5 and 12 digits"),
  body("value")
    .if((value, { req }) => req.body.type === "email")
    .isEmail()
    .withMessage("Invalid email address"),
  body("otp", "Invalid Otp")
    .trim()
    .notEmpty()
    .matches(/^[0-9]+$/)
    .isLength({ min: 6, max: 6 }),
  body("token", "Invalid token").trim().notEmpty(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req).array({ onlyFirstError: true });
    if (errors.length > 0) {
      return next(createError(errors[0].msg, 400, errorCode.invalid));
    }

    const { type, value, otp, token } = req.body;

    const user = await getUserByValue(value, type);
    checkUserIfExist(user);

    const otprow = await getOtpByValue(value);
    checkOtpExist(otprow);
    let result;

    const lastOtpRequest = new Date(otprow!.updatedAt).toLocaleDateString();
    const today = new Date().toLocaleDateString();
    const isSameDay = lastOtpRequest === today;
    checkOtpErrorIfSameDate(isSameDay, otprow!.requestError);

    if (otprow?.rememberToken !== token) {
      const otpData = {
        error: 5,
      };
      await updateOtp(otprow!.id, otpData);
    }

    const isExpired = moment().diff(otprow?.updatedAt, "minutes") > 1;
    if (isExpired) {
      return next(
        createError(
          "OTP has expired. Please request a new one.",
          403,
          "otpExpired"
        )
      );
    }
    const isMatchOtp = await bcrypt.compare(otp, otprow?.otpCode || "");

    if (!isMatchOtp) {
      if (!isSameDay) {
        const otpData = {
          requestError: 1,
        };
        await updateOtp(otprow!.id, otpData);
      } else {
        const otpData = {
          requestError: {
            increment: 1,
          },
        };
        await updateOtp(otprow!.id, otpData);
      }
      return next(createError("OTP is not correct!", 401, "invalidOtp"));
    }

    const verifyToken = generateToken();
    const otpData = {
      verifyToken,
      requestError: 0,
      attemptCount: 1,
      verifyAt: new Date(),
    };

    result = await updateOtp(otprow!.id, otpData);
    res.status(200).json({
      message: "You are Successfully Verified!",
      value: result.recipient,
      token: result.verifyToken,
    });
  },
];

export const confirmPassword = [
  body("type", "Invalid registration type")
    .trim()
    .notEmpty()
    .isIn(["phone", "email"])
    .withMessage("Registration type must be either phone or email"),
  body("value").trim().notEmpty().withMessage("Value is required"),
  body("value")
    .if((value, { req }) => req.body.type === "phone")
    .matches(/^[0-9]+$/)
    .withMessage("Phone number must contain only digits")
    .isLength({ min: 5, max: 12 })
    .withMessage("Phone number must be between 5 and 12 digits"),
  body("value")
    .if((value, { req }) => req.body.type === "email")
    .isEmail()
    .withMessage("Invalid email address"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8, max: 72 })
    .withMessage("Password must be between 8 and 72 characters")
    .matches(/[a-z]/)
    .withMessage("Password must contain at least one lowercase letter")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter")
    .matches(/[0-9]/)
    .withMessage("Password must contain at least one number")
    .matches(/[^A-Za-z0-9]/)
    .withMessage("Password must contain at least one special character"),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req).array({ onlyFirstError: true });
    if (errors.length > 0) {
      return next(createError(errors[0].msg, 400, errorCode.invalid));
    }

    const { type,value, password } = req.body;

    const user = await getUserByValue(type,value);
    checkUserIfExist(user);

    
  },
];
