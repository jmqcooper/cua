// SPDX-License-Identifier: FSL-1.1-MIT
// The assistant runs independently of the window and is reachable only by this Unix user.
import { request } from "node:http";
import { join } from "node:path";
import type { BridgeContext } from "./context";
import { Failure, type Handlers } from "./host";

export function assistantMethods(_ctx: BridgeContext): Handlers {
  return {
    "assistant.call": async (args) => {
      if (process.platform !== "linux") throw Failure.unsupported("The assistant is hosted on r2d2.");
      if (typeof args.action !== "string") throw Failure.badArgs("Missing assistant action");
      const action = args.action;
      const socketPath = process.env.CUA_ASSISTANT_SOCKET || join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid!()}`, "cua-assistant.sock");
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({ action: args.action, args: args.args || {} });
        const req = request({ socketPath, path: "/call", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: action === "desktop.start" ? 900000 : action.startsWith("mobile.") ? 300000 : 45000 }, (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; if (data.length > 4 * 1024 * 1024) req.destroy(new Error("Assistant response too large")); });
          res.on("end", () => {
            try { const reply = JSON.parse(data); if (reply.ok) resolve(reply.result); else reject(Failure.failed(reply.error || "Assistant request failed")); }
            catch (error) { reject(error); }
          });
        });
        req.on("error", () => reject(Failure.failed("The r2d2 assistant service is unavailable. Run systemctl --user restart cua-assistant.service.")));
        req.on("timeout", () => req.destroy(new Error("Assistant request timed out")));
        req.end(body);
      });
    },
  };
}
