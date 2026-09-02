import { Request, Response, NextFunction } from "express";
import { body, check, validationResult } from "express-validator";
import bcrypt from "bcrypt";
import moment from "moment";
import "dotenv/config";
import { createError } from "../utils/error";
import { errorCode } from "../../config/error";
import jwt from "jsonwebtoken";
import {
  createOtp,
  createUser,
  getOtpByValue,
  getUserById,
  getUserByValue,
  updateOtp,
  updateUser,
} from "../services/authServices";
import {
  checkOtpErrorIfSameDate,
  checkOtpExist,
  checkUserIfExist,
  checkUserIfNotExist,
  Continent,
  COUNTRIES_BY_CONTINENT,
} from "../utils/auth";
import { generateToken } from "../utils/generate";
import { OtpChannel, Prisma } from "../../generated/prisma/client";
import { UserCreateInput } from "../../generated/prisma/models";
import validator from "validator";

type RegistrationType = "phone" | "email";

interface CountryContinentRequestBody {
  type: RegistrationType;
  value: string;
  continentId: number;
  countryCode: string;
}

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
              errorCode.overLimit,
            ),
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
          "otpExpired",
        ),
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
  body("token", "Invalid token").trim().notEmpty(),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req).array({ onlyFirstError: true });
    if (errors.length > 0) {
      return next(createError(errors[0].msg, 400, errorCode.invalid));
    }

    const { type, value, token, password } = req.body;

    const user = await getUserByValue(type, value);
    checkUserIfExist(user);

    const otpRow = await getOtpByValue(value);
    checkOtpExist(otpRow);

    if (otpRow?.verifyToken != token) {
      return next(
        createError("You are not authenticated user!", 400, errorCode.attack),
      );
    }

    const isExpired = moment().diff(otpRow?.updatedAt, "minutes") > 1;
    if (isExpired) {
      return next(
        createError(
          "OTP has expired. Please request a new one.",
          403,
          "otpExpired",
        ),
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);

    const randToken = "I will replace later";
    const userData: UserCreateInput = {
      email: type === "email" ? value : null,
      phone: type === "phone" ? value : null,
      password: hashPassword,
      refreshToken: randToken,
    };

    const newUser = await createUser(userData);

    const accessTokenPayload = {
      id: newUser.id,
    };

    const refreshTokenPayload = {
      id: newUser.id,
      recipient:
        newUser.email === null || undefined ? newUser.phone : newUser.email,
    };

    const accessToken = jwt.sign(
      accessTokenPayload,
      process.env.ACCESS_TOKEN_SECRET!,
      { expiresIn: 60 * 15 },
    ); // 15min

    const refreshToken = jwt.sign(
      refreshTokenPayload,
      process.env.REFRESH_TOKEN_SECRET!,
      { expiresIn: 60 * 60 * 30 * 24 },
    ); //1 month

    const userUpdateData = {
      refreshToken,
    };

    await updateUser(newUser.id, userUpdateData);

    res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, //30days
      })
      .status(201)
      .json({
        message: "Successfully created new account",
        userid: newUser.id,
      });
  },
];

export const login = [
  body("type", "Invalid registration type")
    .trim()
    .notEmpty()
    .isIn(["phone", "email"]),
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
    .withMessage("Password must be between 8 and 72 characters"),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req).array({ onlyFirstError: true });
    if (errors.length > 0) {
      return next(createError(errors[0].msg, 400, errorCode.invalid));
    }

    const { type, value, password } = req.body;

    const user = await getUserByValue(value, type);
    checkUserIfNotExist(user);

    if (!user?.password) {
      return next(
        createError(
          "Invalid email/phone or password",
          401,
          errorCode.unauthenticated,
        ),
      );
    }

    const isMatchPassword = await bcrypt.compare(password, user!.password);
    if (!isMatchPassword) {
      const today = new Date().toLocaleDateString();
      const lastRequest = user!.updatedAt.toLocaleDateString();
      const sameDay = today === lastRequest;

      if (!sameDay) {
        const updateUserData = {
          errorLoginCount: 1,
        };
        await updateUser(user!.id, updateUserData);
      } else {
        if (user!.errorLoginCount >= 5) {
          const validTime = moment().diff(user!.updatedAt, "minutes") > 1;
          if (!validTime) {
            return next(
              createError("Please try again later", 429, errorCode.overLimit),
            );
          } else {
            const userData = {
              errorLoginCount: 1,
            };
            await updateUser(user!.id, userData);
          }
        } else {
          const userData = {
            errorLoginCount: {
              increment: 1,
            },
          };
          await updateUser(user!.id, userData);
        }
      }
      return next(
        createError("Password is not correct!", 401, errorCode.unauthenticated),
      );
    }

    if (user!.status === "FREEZE") {
      return next(
        createError(
          "Your account has been frozen. Please contact support.",
          403,
          errorCode.accountFreeze,
        ),
      );
    }

    const accessTokenPayload = {
      id: user!.id,
    };

    const recipient = user!.email ?? user!.phone;

    const refreshTokenPayload = {
      id: user!.id,
      recipient: recipient,
    };

    const accessToken = jwt.sign(
      accessTokenPayload,
      process.env.ACCESS_TOKEN_SECRET!,
      { expiresIn: 60 * 15 },
    ); //15 minutes
    const refreshToken = jwt.sign(
      refreshTokenPayload,
      process.env.REFRESH_TOKEN_SECRET!,
      { expiresIn: "30d" },
    ); //30 days

    const userData = {
      errorLoginCount: 0,
      randToken: refreshToken,
    };
    await updateUser(user!.id, userData);

    res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 15 * 60 * 1000, //15minutes
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000, //30days
      })
      .status(200)
      .json({ message: "Successfully Logged In", userid: user!.id });
  },
];

export const countryContinent = [
  body("type")
    .isString()
    .withMessage("Registration type must be a string")
    .trim()
    .notEmpty()
    .withMessage("Registration type is required")
    .bail()
    .isIn(["phone", "email"])
    .withMessage("Registration type must be phone or email"),

  body("value")
    .isString()
    .withMessage("Value must be a string")
    .trim()
    .notEmpty()
    .withMessage("Value is required"),

  body("value")
    .if((_value, { req }) => req.body.type === "phone")
    .matches(/^[0-9]+$/)
    .withMessage("Phone number must contain only digits")
    .isLength({ min: 5, max: 12 })
    .withMessage("Phone number must be between 5 and 12 digits"),

  body("value")
    .if((_value, { req }) => req.body.type === "email")
    .isEmail()
    .withMessage("Invalid email address"),

  body("continentId")
    .notEmpty()
    .withMessage("Continent is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Invalid continent ID")
    .toInt(),

  body("countryCode")
    .isString()
    .withMessage("Country code must be a string")
    .trim()
    .notEmpty()
    .withMessage("Country is required")
    .bail()
    .isAlpha()
    .withMessage("Country code must contain only letters")
    .isLength({ min: 2, max: 2 })
    .withMessage("Country code must contain exactly 2 letters")
    .toUpperCase(),

  async (
    req: Request<Record<string, never>, unknown, CountryContinentRequestBody>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const errors = validationResult(req).array({
        onlyFirstError: true,
      });

      if (errors.length > 0) {
        return next(createError(errors[0].msg, 400, errorCode.invalid));
      }

      const { type, value, continentId, countryCode } = req.body;

      // const country =
      //   await prismaClient.country.findFirst({
      //     where: {
      //       code: countryCode,
      //       continentId,
      //     },
      //     select: {
      //       id: true,
      //       name: true,
      //       code: true,
      //       continent: {
      //         select: {
      //           id: true,
      //           name: true,
      //         },
      //       },
      //     },
      //   });

      // if (!country) {
      //   return next(
      //     createError(
      //       "Selected country does not belong to the selected continent",
      //       400,
      //       errorCode.invalid
      //     )
      //   );
      // }

      // const identityData =
      //   type === "email"
      //     ? {
      //         email: value.toLowerCase(),
      //       }
      //     : {
      //         phone: value,
      //       };

      // const userData: Prisma.UserCreateInput = {
      //   ...identityData,

      //   country: {
      //     connect: {
      //       id: country.id,
      //     },
      //   },
      // };

      return res.status(200).json({
        message: "Country and continent are valid",
      });
    } catch (error) {
      return next(error);
    }
  },
];

export const logout = [
  async (req: Request, res: Response, next: NextFunction) => {
    const refreshToken = req.cookies ? req.cookies.refreshToken : null;

    if (!refreshToken) {
      return next(
        createError(
          "You are not authenticated user!",
          401,
          errorCode.unauthenticated,
        ),
      );
    }

    let decoded;

    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!) as {
        id: number;
        recipient: string;
      };
    } catch (err) {
      return next(
        createError(
          "You are not authenticated user!",
          401,
          errorCode.unauthenticated,
        ),
      );
    }

    const user = await getUserById(decoded.id);
    checkUserIfNotExist(user);

    if (user!.email != decoded.recipient || user!.phone != decoded.recipient) {
      return next(
        createError(
          "You are not authenticated user!",
          401,
          errorCode.unauthenticated,
        ),
      );
    }

    const userData = {
      refreshToken: generateToken(),
    };

    await updateUser(user!.id, userData);

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    });

    res.status(200).json({ message: "Successfully Logged Out!." });
  },
];

export const forgetPassword = [
  body("identifier")
    .trim()
    .notEmpty()
    .withMessage("Email or phone number is required")
    .bail()
    .custom((value: string) => {
      if (value.includes("@")) {
        if (!validator.isEmail(value)) {
          throw new Error("Invalid email address");
        }
        return true;
      }

      if (!/^\+[1-9]\d{7,14}$/.test(value)) {
        throw new Error(
          "Invalid phone number. Use format such as +819012345678",
        );
      }
      return true;
    }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req).array({ onlyFirstError: true });
    if (errors.length > 0) {
      return next(createError(errors[0].msg, 400, errorCode.invalid));
    }
    const { identifier } = req.body;
    const type: RegistrationType = identifier.includes("@") ? "email" : "phone";

    const user = await getUserByValue(identifier, type);
    checkUserIfNotExist(user);

    const channel: OtpChannel =
      type === "email" ? OtpChannel.EMAIL : OtpChannel.PHONE;

    const otp = 123456; // TODO: Remove this line and uncomment the above line when in production
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otp.toString(), salt);
    const token = generateToken();

    const otpRow = await getOtpByValue(identifier);
    let result;
    if (!otpRow) {
      const otpData: Prisma.OtpCreateInput = {
        recipient: identifier,
        otpCode: hashedOtp,
        rememberToken: token,
        purpose: "REGISTER",
        channel,
      };
      result = await createOtp(otpData);
    } else {
      const lastOtpRequest = new Date(otpRow.updatedAt).toLocaleDateString();
      const today = new Date().toLocaleDateString();
      const isSameDay = lastOtpRequest === today;
      checkOtpErrorIfSameDate(isSameDay, otpRow.attemptCount);
      if (!isSameDay) {
        const otpData: any = {
          otpCode: hashedOtp,
          rememberToken: token,
          attemptCount: 1,
          requestError: 0,
        };
        result = await updateOtp(otpRow.id, otpData);
      } else {
        if (otpRow.attemptCount === 5) {
          return next(
            createError(
              "You have reached the maximum number of OTP requests for today. Please try again tomorrow.",
              400,
              errorCode.overLimit,
            ),
          );
        } else {
          const otpData: any = {
            otpCode: hashedOtp,
            rememberToken: token,
            attemptCount: {
              increment: 1,
            },
          };
          result = await updateOtp(otpRow.id, otpData);
        }
      }
    }
    res.status(200).json({
      message: `OTP  successfully sent to ${identifier} for reset password!`,
      value: result.recipient,
      token: result.rememberToken,
    });
  },
];
