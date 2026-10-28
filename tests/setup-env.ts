import { randomBytes } from "node:crypto";
process.env.MASTER_KEY ??= randomBytes(32).toString("base64");
process.env.SESSION_SECRET ??= randomBytes(32).toString("base64");
