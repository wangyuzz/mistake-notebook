import "dotenv/config";
import { createPlatformStore } from "./platform-store.mjs";
import { createApp } from "./app.mjs";
import { encryptionKey } from "./auth.mjs";
const store = await createPlatformStore({
  connectionString: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE || undefined,
  ssl: process.env.DATABASE_SSL === "true",
});
const key = await encryptionKey();
const server = createApp(store, { encryptionKey: key }).listen(
  Number(process.env.PORT) || 3001,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "拾题 API · http://" +
        (process.env.HOST || "127.0.0.1") +
        ":" +
        (process.env.PORT || 3001) +
        " · " +
        store.mode,
    ),
);
async function stop() {
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
