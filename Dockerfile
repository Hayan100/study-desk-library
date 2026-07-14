FROM node:22.17.0-alpine3.22
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
# SECURITY: the server does not need root privileges in production.
USER node
CMD ["npm", "start"]
