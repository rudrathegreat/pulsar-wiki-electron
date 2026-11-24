'use strict';

require('../server').runServer({ port: Number(process.argv[2] || 0) }).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
