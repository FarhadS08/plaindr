import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifySupabaseSession, type AuthedUser } from "./supabaseAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AuthedUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: AuthedUser | null = null;
  try {
    user = await verifySupabaseSession(opts.req);
  } catch {
    user = null;
  }
  return { req: opts.req, res: opts.res, user };
}
