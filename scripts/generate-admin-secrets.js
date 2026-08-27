const { pbkdf2Sync, randomBytes } = require("crypto");

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/generate-admin-secrets.js <admin-password>");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");

console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log(`ADMIN_PASSWORD_SALT=${salt}`);
console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString("hex")}`);

console.log("ADMIN_RECOVERY_EMAIL=awrcdirector@gmail.com");
