import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

interface customRequest extends Request {
  userId?: number;
}

export const auth = (req: customRequest, res: Response, next: NextFunction) => {
  // Get the token from the request header
};
