/**
 * Slack ボット起動（Socket Mode = 公開 URL 不要、あなたの PC で動く）。
 *   npm run bot
 * 必要な Slack 側設定は README を参照。
 */
import { App } from "@slack/bolt";
import { config } from "../config.js";
import { registerHandlers } from "./handlers.js";
import { closeAll } from "../db/client.js";

const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
});

registerHandlers(app);

app
  .start()
  .then(() => {
    console.log("⚡ Slack ボット起動（Socket Mode）。メンション or DM で質問してください。Ctrl+C で終了。");
    console.log(`   モデル: ${config.openai.chatModel} / 閾値: ${config.search.similarityThreshold} / topK: ${config.search.topK}`);
  })
  .catch((e) => {
    console.error("起動失敗:", e);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  await app.stop();
  await closeAll();
  process.exit(0);
});
