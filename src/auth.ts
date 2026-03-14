import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer } from "better-auth/plugins";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

let _auth: ReturnType<typeof betterAuth> | null = null;

export function getAuth() {
    if (_auth) return _auth;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");

    const adapter = new PrismaNeon({ connectionString });
    const prisma = new PrismaClient({ adapter });

    _auth = betterAuth({
        database: prismaAdapter(prisma, {
            provider: "postgresql",
        }),
        plugins: [bearer(), admin()],
        user: {
            additionalFields: {
                role: {
                    type: "string",
                    required: true,
                    defaultValue: "STAFF",
                },
                tenantId: {
                    type: "string",
                    required: true,
                },
            },
        },
    });

    return _auth;
}
