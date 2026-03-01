import { Telegraf } from "telegraf";
import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("🚨 텔레그램 토큰이 없습니다. .env 파일을 확인하세요!");
  process.exit(1);
}

const bot = new Telegraf(token);

// /start 명령어 입력 시 답변
bot.start((ctx) => ctx.reply("안녕하세요! SuicaTap 에이전트가 텔레그램에 연결되었습니다. 🤖"));

// 아무 말이나 입력 시 앵무새처럼 따라하기
bot.on("text", (ctx) => {
  ctx.reply(`수신 완료: "${ctx.message.text}"\n(현재 뇌(OpenClaw) 연결을 준비 중입니다 🧠)`);
});

bot.launch();
console.log("✅ 텔레그램 봇 실행 완료! 텔레그램 앱에서 봇에게 말을 걸어보세요.");

// 안전한 종료 처리
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
