import "dotenv/config";

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log("OPENAI_API_KEY is NOT set or empty.");
} else {
  console.log(`OPENAI_API_KEY is configured (length: ${key.length}, prefix: ${key.slice(0, 3)}...)`);
}
