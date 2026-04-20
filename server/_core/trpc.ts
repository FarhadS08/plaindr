import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { supabaseAsUser } from "./supabase";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Every protected request carries a per-user Supabase client
// (`ctx.supabase`) that forwards the caller's access token. RLS
// policies evaluate as that user via `auth.uid()`.
const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  const supabase = supabaseAsUser(ctx.user.accessToken);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      supabase,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    const supabase = supabaseAsUser(ctx.user.accessToken);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        supabase,
      },
    });
  }),
);
