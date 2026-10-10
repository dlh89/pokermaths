FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8766 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json server.js auth.js db.js engine.js questions.js ./
COPY --chown=node:node static ./static
COPY --chown=node:node scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8766
CMD ["node", "server.js"]
