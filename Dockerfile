# Node runs the TypeScript source directly, and there are no runtime dependencies, so there's no
# build stage and no npm install.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY src ./src
# Built from a UGREEN NAS shared folder, the copied files arrive as mode 0770 (no access for
# "others"), so make them readable. They stay owned by root, so the site can't modify them.
RUN chmod -R a+rX package.json src

# Run as the image's unprivileged "node" user, not root.
USER node
CMD ["node", "src/index.ts"]
