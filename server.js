const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 10000;
const publicDir = __dirname;

app.use(
  express.static(publicDir, {
    extensions: ["html"],
  }),
);

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`AWRC Hub running on port ${port}`);
});
