# ==============================================
# Stage 1: Builder Stage
# ==============================================
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Copy source code
COPY . .

# Set dummy DATABASE_URL for prisma generate
ENV DATABASE_URL="postgresql://dummy:dummy@dummy:5432/dummy?schema=public"

# Generate Prisma Client
RUN npx prisma generate

# Build the app
RUN pnpm run build

# ==============================================
# Stage 2: Production Stage
# ==============================================
FROM node:22-alpine AS production

WORKDIR /usr/src/app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./


# Install production dependencies ONLY (no dev dependencies)
RUN pnpm install --prod

# Add prisma CLI for runtime migrations
RUN pnpm add prisma

# Copy built application
COPY --from=builder /usr/src/app/dist ./dist

# Copy Prisma schema and config (needed for db push at runtime)
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/prisma.config.ts ./prisma.config.ts

# Copy generated Prisma client (output is at generated/prisma/ per schema config)
COPY --from=builder /usr/src/app/generated ./generated

EXPOSE 4000

CMD ["node", "dist/src/main.js"]