import http from "http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/db.js";
import { createSocketServer } from "./sockets/index.js";

const RAPIDAPI_KEY = "d36565c2b4mshe5d8acae744634cp14ec72jsn2b398a71fe9e";

await connectDatabase();
const app = createApp();
const server = http.createServer(app);
const io = createSocketServer(server);
app.set("io", io);

server.listen(env.PORT, () => 
  console.log(`Tourism Guardian server running on http://localhost:${env.PORT}`)
);