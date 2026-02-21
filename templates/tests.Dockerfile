FROM mcr.microsoft.com/playwright:v1.58.2-noble AS base
FROM eclipse-temurin:21-jre AS jre21
FROM base

USER root

ARG FIREBASE_CONFIG_PATH=firebase.json
ARG FIRESTACK_FUNCTIONS_INSTALL_PATHS=

COPY --from=jre21 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /opt/deps

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
  if [ -f package.json ]; then (npm ci || npm install); fi

RUN npm install -g firebase-tools \
  && mkdir -p /opt/firebase/emulators \
  && FIREBASE_EMULATORS_PATH=/opt/firebase/emulators firebase setup:emulators:firestore

COPY . .

RUN --mount=type=cache,target=/root/.npm \
  if [ -n "$FIRESTACK_FUNCTIONS_INSTALL_PATHS" ]; then \
    IFS=',' read -r -a firestack_functions <<< "$FIRESTACK_FUNCTIONS_INSTALL_PATHS"; \
    for rel in "${firestack_functions[@]}"; do \
      [ -z "$rel" ] && continue; \
      [ ! -f "$rel/package.json" ] && continue; \
      (cd "$rel" && (npm ci || npm install)); \
    done; \
  elif [ -f "$FIREBASE_CONFIG_PATH" ]; then \
    FIREBASE_CONFIG_PATH="$FIREBASE_CONFIG_PATH" node -e "const fs=require('fs');const p=process.env.FIREBASE_CONFIG_PATH||'firebase.json';const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const found=[];const add=(v)=>{if(typeof v!=='string')return;const n=v.trim().replace(/\\\\/g,'/').replace(/^\\.\\//,'');if(!n||n.startsWith('/')||n.includes('..'))return;if(fs.existsSync(n+'/package.json'))found.push(n);};const f=cfg.functions;if(typeof f==='string')add(f);else if(Array.isArray(f)){for(const e of f){if(typeof e==='string')add(e);else if(e&&typeof e==='object')add(e.source);}}else if(f&&typeof f==='object')add(f.source);process.stdout.write([...new Set(found)].join('\n'));" >/tmp/firestack-functions-paths; \
    while IFS= read -r rel; do \
      [ -z "$rel" ] && continue; \
      (cd "$rel" && (npm ci || npm install)); \
    done < /tmp/firestack-functions-paths; \
  elif [ -f functions/package.json ]; then (cd functions && (npm ci || npm install)); fi

WORKDIR /work
