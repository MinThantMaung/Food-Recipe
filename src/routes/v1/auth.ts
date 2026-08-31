import express from 'express';
import { register } from '../../controllers/authController';

const router = express.Router();

router.post('/register', register);
// router.post('/verify-otp', varifyOtp);
// router.post('/confirm-password', confirmPassword);
// router.post('/login', login);
// router.post('/logout', logout);

//google login route
//router.post("/auth/google", googleLogin);

export default router;