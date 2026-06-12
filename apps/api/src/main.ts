import { buildServer } from './server.js';
import { config } from './config.js';

buildServer()
  .then((app) => app.listen({ port: config.port, host: '0.0.0.0' }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
