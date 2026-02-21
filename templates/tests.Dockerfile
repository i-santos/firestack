ARG FIRESTACK_DOCKER_BASE_IMAGE=mcr.microsoft.com/playwright:v1.58.2-noble
FROM ${FIRESTACK_DOCKER_BASE_IMAGE}

USER root

ARG FIRESTACK_TEST_CAPABILITY=e2e
ARG FIREBASE_CONFIG_PATH=firebase.json

RUN if [ "$FIRESTACK_TEST_CAPABILITY" != "unit" ]; then \
    apt-get update \
    && apt-get install -y --no-install-recommends openjdk-21-jre-headless ca-certificates \
    && rm -rf /var/lib/apt/lists/*; \
  fi

WORKDIR /opt/deps

COPY . .

RUN if [ -f package.json ]; then (npm ci || npm install); fi \
  && if [ "$FIRESTACK_TEST_CAPABILITY" != "unit" ]; then \
    if [ -f "$FIREBASE_CONFIG_PATH" ]; then \
      FIREBASE_CONFIG_PATH="$FIREBASE_CONFIG_PATH" node -e "const fs=require('fs');const p=process.env.FIREBASE_CONFIG_PATH||'firebase.json';const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const found=[];const add=(v)=>{if(typeof v!=='string')return;const n=v.trim().replace(/\\\\/g,'/').replace(/^\\.\\//,'');if(!n||n.startsWith('/')||n.includes('..'))return;if(fs.existsSync(n+'/package.json'))found.push(n);};const f=cfg.functions;if(typeof f==='string')add(f);else if(Array.isArray(f)){for(const e of f){if(typeof e==='string')add(e);else if(e&&typeof e==='object')add(e.source);}}else if(f&&typeof f==='object')add(f.source);process.stdout.write([...new Set(found)].join('\n'));" >/tmp/firestack-functions-paths; \
      while IFS= read -r rel; do \
        [ -z "$rel" ] && continue; \
        (cd "$rel" && (npm ci || npm install)); \
      done < /tmp/firestack-functions-paths; \
    elif [ -f functions/package.json ]; then (cd functions && (npm ci || npm install)); fi; \
    npm install -g firebase-tools; \
    mkdir -p /opt/firebase/emulators; \
    FIREBASE_EMULATORS_PATH=/opt/firebase/emulators firebase setup:emulators:firestore; \
  fi

WORKDIR /work
