FROM rust

LABEL "com.github.actions.name"="Criterion compare"
LABEL "com.github.actions.description"="Compare the performance of a PR against master"
LABEL "com.github.actions.icon"="refresh-cw"
LABEL "com.github.actions.color"="purple"

# Install critcmp
RUN cargo install critcmp

# Install Node.js
ENV NODE_VERSION 12.0.0
ENV PATH /root/.nvm/versions/node/v$NODE_VERSION/bin:$PATH
RUN curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash
# Check that Node.js was correctly installed
RUN node --version

# Copy over project files
COPY . .

# Install dependencies
RUN npm install

ENTRYPOINT ["node", "/entrypoint.js"]
