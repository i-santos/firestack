FROM mcr.microsoft.com/playwright:v1.58.2-noble

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/deps

COPY . .

RUN if [ -f package.json ]; then (npm ci || npm install); fi \
  && if [ -f functions/package.json ]; then (cd functions && (npm ci || npm install)); fi \
  && npm install -g firebase-tools \
  && mkdir -p /opt/firebase/emulators \
  && FIREBASE_EMULATORS_PATH=/opt/firebase/emulators firebase setup:emulators:firestore

WORKDIR /work
