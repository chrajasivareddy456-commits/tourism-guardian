import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  WEATHER_API_KEY: z.string().min(1),
  CLIENT_URL: z.string().url(),
  SOCKET_URL: z.string().url(),
  AUTHORITY_INVITE_CODE: z.string().min(8).optional(),
  TRUSTED_CONTACT_WEBHOOK_URL: z.string().url().optional()
});

export const env = schema.parse(process.env);
