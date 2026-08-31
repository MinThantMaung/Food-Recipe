import { randomBytes } from "crypto"

export const generateToken = () => {
    return randomBytes(32).toString("hex");
}