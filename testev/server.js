var express = require("express");
var app = express();
var cfenv = require("cfenv");
var bodyParser = require('body-parser')

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
app.use(bodyParser.json())

var mydb;

/* Endpoint to greet and add a new visitor to database.
* Send a POST request to localhost:3000/api/visitors with body
* {
* 	"name": "Bob"
* }
*/
app.post("/api/visitors", function (request, response) {
  var userName = request.body.name;
  if(!mydb) {
    console.log("No database.");
    response.send("Hello " + userName + "!");
    return;
  }
  // insert the username as a document
  mydb.insert({ "name" : userName }, function(err, body, header) {
    if (err) {
      return console.log('[mydb.insert] ', err.message);
    }
    response.send("Hello " + userName + "! I added you to the database.");
  });
});

/**
 * Endpoint to get a JSON array of all the visitors in the database
 * REST API example:
 * <code>
 * GET http://localhost:3000/api/visitors
 * </code>
 *
 * Response:
 * [ "Bob", "Jane" ]
 * @return An array of all the visitor names
 */
app.get("/api/visitors", function (request, response) {
  var names = [];
  if(!mydb) {
    response.json(names);
    return;
  }

  mydb.list({ include_docs: true }, function(err, body) {
    if (!err) {
      body.rows.forEach(function(row) {
        if(row.doc.name)
          names.push(row.doc.name);
      });
      response.json(names);
    }
  });
});


// load local VCAP configuration  and service credentials
var vcapLocal;
try {
  vcapLocal = require('./vcap-local.json');
  console.log("Loaded local VCAP", vcapLocal);
} catch (e) { }

const appEnvOpts = vcapLocal ? { vcap: vcapLocal} : {}

const appEnv = cfenv.getAppEnv(appEnvOpts);

if (appEnv.services['cloudantNoSQLDB']) {
  // Load the Cloudant library.
  var Cloudant = require('cloudant');

  // Initialize database with credentials
  var cloudant = Cloudant(appEnv.services['cloudantNoSQLDB'][0].credentials);

  //database name
  var dbName = 'mydb';

  // Create a new "mydb" database.
  cloudant.db.create(dbName, function(err, data) {
    if(!err) //err if database doesn't already exists
      console.log("Created database: " + dbName);
  });

  // Specify the database we are going to use (mydb)...
  mydb = cloudant.db.use(dbName);
}

//serve static file (index.html, images, css)
app.use(express.static(__dirname + '/views'));


var express = require("express"),
	http = require("http"),
	socket = require("socket.io"),
  path = require("path"),
  fs = require("fs"),
  async = require("async"),
  clientDeps = [
    "/js/loader.js",
    "/js/impress.js"
  ],
  Server;


module.exports = Server = function(dir, port, pass) {
  this.port = port || 8080;
  this.dir = dir || ".";
  this.pass = pass;
}

Server.prototype.start = function(dir, port) {
  this.port = port || this.port;
  this.dir = dir || this.dir;

  this.setupApp();

  this.server = http.createServer(this.app);
  this.io = socket.listen(this.server, {
    "log level": 0
  });
  this.setupSocket();
  this.server.listen(this.port);
  console.log(
    "Impress-server serves directory: " +
    path.resolve(this.dir) + " on port: " + this.port
  );
  console.log("To claim presenter mode use the following password: " + this.getPass());
}

Server.prototype.setupApp = function() {
  this.app = express();
  this.setupImpressRoute();
  this.setupStaticDirs();
}

Server.prototype.setupImpressRoute = function() {
  this.app.get(/impress.js/, function(request, response) {
    response.set('Content-Type', 'text/javascript');
    /*if(this.impress) {
      response.send(this.impress);
      return;
    }*/

    var files = [];
    for(var i=0; i<clientDeps.length; i++) {
      files[i] = __dirname + clientDeps[i];
    }

    async.map(files, fs.readFile, function(err, res) {
      this.impress = res.join('');
      response.send(this.impress);
    });

  });
};

Server.prototype.setupStaticDirs = function() {
  this.app.use("/js", express.static(__dirname + "/js"));
  this.app.use(express.static(path.resolve(this.dir)));
  this.app.use(express.static(__dirname + "/public"));
};

Server.prototype.getPass = function() {
  if(!this.pass) {
    var crypto = require('crypto');
    this.pass = crypto.createHash('md5')
                .update(String(new Date().valueOf()))
                .digest("hex").substring(0,4);
  }
  return this.pass;
}

Server.prototype.setupSocket = function() {
  var io = this.io, presenter, currentSlide, totalSlides, self = this;
  io.sockets.on('connection', function (socket) {

    socket.on("register:viewer", function(data) {

        if( ! presenter ) {
          socket.emit("mode:presenter", {broadcast: false});
          totalSlides = data.totalSlides;
        } else {
          socket.emit('mode:view', {slide:currentSlide});
          if(presenter == socket) {
            totalSlides = data.totalSlides;
          }
        }

        socket.on('follow:presenter', function() {
          socket.emit("mode:view", {slide: currentSlide});
        });
    });

    socket.on("register:remote", function(data) {
        var data = {
          slide: (currentSlide || 0),
          totalSlides: (totalSlides || 0)
        };
        socket.emit("init:remote", data);
    });

    socket.on('release:presenter', function() {
      if(socket == presenter) {
        presenter = null;
        io.sockets.emit("mode:presenter", {broadcast: false});
      }
    });

    socket.on('claim:presenter', function(data) {
      console.log("claim with ", data);

      if( self.getPass() == data.pass ) {
        if(presenter == socket) return;

        currentSlide = data.slide;
        if(presenter) {
          presenter.emit('mode:view', {slide: currentSlide});
        } else {
          socket.broadcast.emit('mode:view', {slide: currentSlide});
        }

        presenter = socket;
        socket.emit("mode:presenter", {broadcast: true});
      }
    });

    socket.on('goto', function (data) {
      if(presenter == socket) {
        currentSlide = data.slide;
        socket.broadcast.emit('goto', data);
      }
    });

    socket.on('disconnect', function() {
      if(presenter == socket) {
        presenter = null;
        currentSlide = null;
        socket.broadcast.emit("mode:presenter", {broadcast: false});
      }
    });
  });
}
// var port = process.env.PORT || 3000
// app.listen(port, function() {
//     console.log("To view your app, open this link in your browser: http://localhost:" + port);
// });
