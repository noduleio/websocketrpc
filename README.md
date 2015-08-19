# websocketrpc

Simple Javascript RPC mechanism over websockets

## Installation

```sh
npm install github:noduleio/websocketrpc
```
#Usage

## Client

### Providing a local object

Local objects are added using the addLocalObject function.

```js
var Client = require('websocketrpc').Client;

var localObject = {
	// properties will appear as properties on the remote object (read only - changing the values on the remote objects will not update the local object
	property1: 'value1',
	property2: 'value2',
	// functions will be exposed as functions on the remote object (make sure to return Promises from these function
	hello: function(a) { 
		return new Promise((resolve, reject) => { resolve("hello " + a); }); 
	}
};

var client = new Client();
client.on('connected', function() {
	// expose a local object to remote clients
	client.addLocalObject(localObject);
});
client.on('disconnected', function(isError) {
	if(isError) {
		console.log('Lost connection to server');
	}
});

// connect to the server
client.connect('<WEBSOCKET_URL>', '<AUTH_TOKEN>').then(function() {
	console.log('Connected to server');
}, function(error) {
	// an error occurred connecting to the server
	console.log(error);
});
```
### Consuming a remote object

When an object is added by a remote client the `remoteObjectAdded` event is raised.

```js
var Client = require('websocketrpc').Client;

var client = new Client();
client.on('connected', function() {
	console.log('connected');
});
client.on('disconnected', function(isError) {
	if(isError) {
		console.log('Lost connection to server');
	}
});
client.on('remoteObjectAdded', function(remoteObject) {
	console.log(remoteObject.property1); // "value1"
	console.log(remoteObject.property2); // "value2"
	remoteObject.hello('bob').then(function(result) {
		console.log(result); // 'hello bob'
	}, function(error) {
		console.log(error);
	});
});

// connect to the server
client.connect('<WEBSOCKET_URL>', '<AUTH_TOKEN>').then(function() {
	console.log('Connected to server');
}, function(error) {
	// an error occurred connecting to the server
	console.log(error);
});
```
###Events

You can also raise events on your local object and listen for them on remote clients

```js
// client 1
localObject.raiseEvent('my_event', arg1, arg2, argX);

// client 2
client.on('remoteObjectAdded', function(remoteObject) {
	remoteObject.addEventListener('my_event', function(arg1, arg2, argX) {
		console.log('Got event "my_event"', arg1, arg2, argX);
	});
});
```

##Server
```js
function authenticateCallback(authToken) {
	return new Promise((resolve, reject) => {
		if(AUTHENTICATE_SUCCESS) {
			resolve({ userId: XXX, apiToken: YYY });
		} else {
			reject();
		}
	}
}

var Server = require('websocketrpc'). Server;

var server = new Server({ clustered: true|false, authenticateCallback: authenticateCallback });

// start listening on localhost port 8765
server.start({ port: 8765 });

// or combine with an http server
var app = express(); // create express app...
var httpServer = http.createServer(app);
httpServer.listen(port);

server.start({ server: httpServer });
```

##Clustered mode
Passing true for the clustered option when creating the Server object will switch on clustered mode. This will use Redis a publish and subscribe to communicate between multiple instances of the server.

The connection to redis will either be made to the local machine or on the url provided in `process.env.REDISTOGO_URL`

#Development
Files in the `src` directory use es6/7 code so need to be compiled using `babel`. Run:

```
npm run compile
```

Before committing and pushing latest changes to github.

##Testing
Unit tests are in the tests folder and use `mocha` and `chai`

```
npm run test
```
or

```
npm run test-continuous
```
###Linting
Before pushing to github, lint the code and fix any errors/warnings:

```
npm run lint
```