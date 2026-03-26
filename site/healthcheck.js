import http from "node:http";

const port = Number(process.env.PORT || 3000);

const request = http.get(
  {
    host: "127.0.0.1",
    port,
    path: "/healthz",
    timeout: 5000,
  },
  (response) => {
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);

request.on("error", () => process.exit(1));
request.on("timeout", () => {
  request.destroy();
  process.exit(1);
});
