import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import morgan from "morgan";
import routes  from "./routes/v1";
import { limiter } from "./middlewares/rateLimiter";

export const app = express();

var whitelist = ['http://example1.com', process.env.FRONTEND_URL]
var corsOptions = {
  origin: function (origin:any, callback:(err: Error | null, origin?: any) => void) {
    if (!origin) return callback(null, true);
    if (whitelist.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true, //allow cookies or authorization headers with CORS requests
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet());
app.use(compression());
app.use(cors(corsOptions));
app.use(morgan("combined"));
app.use(limiter)

app.use(routes);
