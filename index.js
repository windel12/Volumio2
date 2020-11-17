var path = require('path');
var dotenv = require('dotenv').config({ path: path.join(__dirname, '.env')}); // eslint-disable-line
var execSync = require('child_process').execSync;
var expressInstance = require('./http/index.js');
var expressApp = expressInstance.app;
/* eslint-disable */
global.metrics = {
  start: {},
  time: (label) => {
    metrics.start[label] = process.hrtime();
  },
  end: {},
  log: (label) => {
    metrics.end[label] = process.hrtime(metrics.start[label]);
    console.log(`\u001b[34m [Metrics] \u001b[39m ${label}: \u001b[31m ${metrics.end[label][0]}s ${(metrics.end[label][1] / 1000000).toFixed(2)}ms \u001b[39m`);
  }
};
/* eslint-disable */
// metrics.start.WebUI = process.hrtime();
metrics.time('WebUI');

// Using port 3000 for the debug interface
expressApp.set('port', 3000);

var httpServer = expressApp.listen(expressApp.get('port'), function () {
  console.log('Express server listening on port ' + httpServer.address().port);
  metrics.log('WebUI');
});

var albumart = require(path.join(__dirname, '/app/plugins/miscellanea/albumart/albumart.js'));

albumart.setFolder('/data/albumart');

expressApp.get('/albumart', albumart.processExpressRequest);
expressApp.get('/tinyart/*', albumart.processExpressRequestTinyArt);
expressApp.get('/albumartd', albumart.processExpressRequestDirect);

expressApp.use(function (err, req, res, next) {
  /**
   * Replace with Winston logging
 **/
  console.log('An internal error occurred while serving an albumart. Details: ' + err.stack);

  /**
    * Sending back error code 500
  **/
  res.sendFile(path.join(__dirname, '/app/plugins/miscellanea/albumart/default.png'));
});

var commandRouter = new (require('./app/index.js'))(httpServer); // eslint-disable-line

expressApp.get('/?*', function (req, res) {
  var userAgent = req.get('user-agent');
  if ((userAgent && userAgent.includes('volumiokiosk')) || process.env.VOLUMIO_3_UI === 'false') {
    res.sendFile(path.join(__dirname, 'http', 'www', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'http', 'www3', 'index.html'));
  }
});

process.on('uncaughtException', (error) => {
  console.log('|||||||||||||||||||||||| WARNING: FATAL ERROR |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||');
  console.log(error);
  console.log('|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||');
  var errorMessage;
  if (error.message !== undefined) {
    errorMessage = error.message;
  } else {
    errorMessage = 'Unknown';
  }
  execSync('/usr/local/bin/node /volumio/crashreport.js "' + errorMessage + '"');
  if (process.env.EXIT_ON_EXCEPTION === 'true') {
    process.exit(1);
  }
});
