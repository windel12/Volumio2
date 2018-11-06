var execSync = require('child_process').execSync;
var fs = require('fs-extra');
var globals = fs.readJsonSync(__dirname + '/.globals.json');
if(!process.env.BASEDIR) {
    process.env.BASEDIR = '/volumio';
}
console.log('Basedir ' + process.env.BASEDIR);


if(process.env.SNAP_COMMON) {
    process.env.DATADIR = process.env.SNAP_COMMON;
}

if(!process.env.DATADIR) {
    process.env.DATADIR = '/data';
}
console.log('Basedir ' + process.env.BASEDIR);
console.log('Datadir ' + process.env.DATADIR);

var expressInstance = require('./http/index.js');
var expressApp = expressInstance.app;
// Using port 3000 for the debug interface
expressApp.set('port', 3000);

var httpServer = expressApp.listen(expressApp.get('port'), function () {
  console.log('Express server listening on port ' + httpServer.address().port);
});

var albumart = require(__dirname + '/app/plugins/miscellanea/albumart/albumart.js');

albumart.setFolder(process.env.DATADIR + '/albumart');

expressApp.get('/albumart', albumart.processExpressRequest);

expressApp.use(function (err, req, res, next) {
  /**
   * Replace with Winston logging
 **/
  console.log('An internal error occurred while serving an albumart. Details: ' + err.stack);

  /**
    * Sending back error code 500
  **/
  res.sendFile(__dirname + '/app/plugins/miscellanea/albumart/default.png');
});

var commandRouter = new (require('./app/index.js'))(httpServer);

expressApp.get('/?*', function (req, res) {
  res.redirect('/');
});

process.on('uncaughtException', (error) => {
  console.log('|||||||||||||||||||||||| WARNING: FATAL ERROR |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||');
  console.log(error);
  console.log('|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||');
  if (error.message != undefined) {
    var errorMessage = error.message;
  } else {
    var errorMessage = 'Unknown';
  }
  execSync('/usr/local/bin/node ' + process.env.BASEDIR + '/crashreport.js "' + errorMessage + '"');
  if (globals.exitOnException) {
    process.exit(1);
  }
});
