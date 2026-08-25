const webPush = require("web-push");

const keys = webPush.generateVAPIDKeys();

console.log("Add these to the AWRC Hub service environment variables in Render:");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:awrcdirector@gmail.com");
