export const authModule = Object.freeze({ id: "auth", stage: "workspace-isolation" });
export { AuthService } from "./service";
export type { AuthRepository, CaptchaProvider, RateLimiter } from "./contracts";
