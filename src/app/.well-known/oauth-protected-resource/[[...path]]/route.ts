import { auth } from "@/lib/auth";

// RFC 9728 must live at the site root; the mcp() plugin answers it when routed through the auth handler.
export const GET = (req: Request) => auth.handler(req);
