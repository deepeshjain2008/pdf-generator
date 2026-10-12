FROM node:16

# Create app user and group
RUN groupadd -g 1001 appgroup \
    && useradd -u 1001 -g appgroup -m appuser
    
WORKDIR /usr/src/app

# Switch old repos to archive repos
RUN sed -i 's|deb.debian.org|archive.debian.org|g' /etc/apt/sources.list \
 && sed -i '/security.debian.org/d' /etc/apt/sources.list \
 && echo "deb https://archive.debian.org/debian/ buster main contrib non-free" > /etc/apt/sources.list

RUN apt-get -o Acquire::Check-Valid-Until=false update

RUN apt install -y libnotify-dev libgconf-2-4 libnss3 libxss1 libasound2 --no-install-recommends --allow-unauthenticated
RUN apt-get update && apt-get install -y wget gnupg ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils --no-install-recommends
RUN apt-get update && apt-get install -y fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf fonts-noto fonts-noto-cjk fonts-indic fonts-lohit-knda fonts-lohit-telu fonts-lohit-deva libxss1 --no-install-recommends --allow-unauthenticated
RUN apt-get install -y fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 --no-install-recommends --allow-unauthenticated
RUN apt-get install -y libdrm2 libgbm1 libnss3 --no-install-recommends --allow-unauthenticated
RUN apt-get install -y fonts-noto-cjk fonts-noto-ui-core fonts-noto-color-emoji --no-install-recommends
RUN apt-get install -y fonts-lohit-knda fonts-navilu --no-install-recommends
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fontconfig wget && mkdir -p /usr/share/fonts/truetype/kannada && cd /tmp && wget -O kannada.ttf "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf" && cp kannada.ttf /usr/share/fonts/truetype/kannada/ && fc-cache -fv && apt-get remove -y wget && rm -rf /var/lib/apt/lists/* /tmp/*

# Verify fonts are installed
RUN fc-list | grep -i kannada

RUN mkdir -p /usr/src/app/user_upload \
    && mkdir -p /usr/src/app/logs \
    && chown -R appuser:appgroup /usr/src/app

COPY package*.json ./
# Install scripts must stay enabled here: puppeteer's postinstall step downloads the
# pinned Chromium binary this image relies on (no system Chrome package is installed).
RUN npm install --omit=dev
RUN npm install -g typescript@5.2.2 --ignore-scripts
COPY tsconfig.json ./
COPY app.ts ./
COPY utils ./utils
COPY configs ./configs
RUN chown -R appuser:appgroup /usr/src/app
RUN npm run build
EXPOSE 3000
USER appuser
CMD [ "node", "dist/app.js" ]
