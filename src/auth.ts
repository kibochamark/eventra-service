import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

let _auth: any = null;

export async function getAuth() {
    if (_auth) return _auth;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");

    const { betterAuth }    = await (new Function('return import("better-auth")')() as Promise<typeof import("better-auth")>);
    const { prismaAdapter } = await (new Function('return import("better-auth/adapters/prisma")')() as Promise<typeof import("better-auth/adapters/prisma")>);
    const { bearer, admin } = await (new Function('return import("better-auth/plugins")')() as Promise<typeof import("better-auth/plugins")>);

    const adapter = new PrismaNeon({ connectionString });
    const prisma  = new PrismaClient({ adapter });

    _auth = betterAuth({
        database: prismaAdapter(prisma, { provider: "postgresql" }),
        baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
        trustedOrigins: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
        plugins: [bearer(), admin()],
        user: {
            additionalFields: {
                role:     { type: "string", required: true, defaultValue: "STAFF" },
                tenantId: { type: "string", required: true },
            },
        },
    });

    return _auth;
}
