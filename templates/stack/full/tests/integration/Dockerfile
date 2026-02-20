FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /opt/deps

RUN apt-get update \
  && apt-get install -y openjdk-21-jre-headless \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g firebase-tools

# Pre-download Firestore emulator so CI docker runs do not fetch it every time.
RUN firebase setup:emulators:firestore

COPY package.json package-lock.json ./
RUN npm ci

WORKDIR /work
