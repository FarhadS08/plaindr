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
// (`ctx.supabase`) that impersonates the authed Clerk user via a
// short-lived JWT signed with SUPABASE_JWT_SECRET. RLS policies
// evaluate as that user, which is why "create organization" no
// longer trips 42501 even with RLS fully on.
const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  const supabase = await supabaseAsUser(ctx.user.id);

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

    const supabase = await supabaseAsUser(ctx.user.id);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        supabase,
      },
    });
  }),
);
