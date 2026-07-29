import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "");
if (!baseUrl.startsWith("https://")) throw new Error("BASE_URL must be an HTTPS staging origin.");

export const options = {
  scenarios: {
    panel_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 },
        { duration: "3m", target: 500 },
        { duration: "5m", target: 1000 },
        { duration: "5m", target: 1000 },
        { duration: "3m", target: 0 }
      ],
      gracefulRampDown: "30s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000", "p(99)<4000"],
    checks: ["rate>0.99"]
  }
};

export default function panelUser() {
  const health = http.get(`${baseUrl}/api/health`, {
    headers: { "x-load-profile": "panel-1000-synthetic" },
    tags: { route: "health" }
  });
  check(health, {
    "health 200": (response) => response.status === 200,
    "health contains no secrets": (response) => !/token|password|service_role/i.test(response.body)
  });
  const login = http.get(`${baseUrl}/login`, {
    headers: { "x-load-profile": "panel-1000-synthetic" },
    tags: { route: "login-shell" }
  });
  check(login, { "login shell 200": (response) => response.status === 200 });
  sleep(1);
}
