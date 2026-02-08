import { providersHandler } from "../backend/llm-proxy.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  providersHandler(req, res);
}
