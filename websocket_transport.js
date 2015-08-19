var WebSocket = require('./ws');
var log = require('./log');
var EventEmitter = require('events').EventEmitter;

class State {
	connect() {
		return null;
	}
	disconnect() {
		return null;
	}
	sendMessage() {
		return null;
	}
	enterState() {
		return null;
	}
	exitState() {
		return null;
	}
	onopen() {
		return null;
	}
	oncloseOrError() {
		return null;
	}
	onmessage() {
		return null;
	}
}

/*eslint-disable no-use-before-define */
class DisconnectedState extends State {
	enterState(context) {
		context.closeWebSocket();
	}
	connect(context) {
		// switch into connecting state where we open the socket and wait for it to either open or fail
		context.processNextState(new ConnectingState());
	}
}

class ConnectingState extends State {
	enterState(context) {
		context.emit(Transport.connectingEvent);
		context.openWebSocket();
	}
	onopen(context) {
		context.processNextState(new AuthenticatingState());
	}
	oncloseOrError(context) {
		context.processNextState(new DisconnectedState());
		context.closeWebSocket();
		context.emit(Transport.connectFailedEvent);
	}
}

class AuthenticatingState extends State {
	enterState(context) {
		context.emit(Transport.authenticatingEvent);
		// request access to the sever with a 5 second timeout on the response
		try {
			context.ws.send(JSON.stringify({ method: "remoteConnect", authToken: context.authToken, params: [context.clientId] }));
		} catch(error) {
			this.onerror(context);
		}
		this.timeoutTimer = setTimeout(() => {
			this.timeoutTimer = null;
			context.closeWebSocket();
		}, 5000);
	}
	onmessage(context, call) {
		log.debug(call);
		if(call.method === 'connected') {
			// successfully authenticated
			context.emit(Transport.authenticatedEvent);
			context.processNextState(new ConnectedState());
		} else if(call.method === 'rejected') {
			// server doesn't like us - we are not authorized
			context.processNextState(new DisconnectedState());
			context.connectNotAuthorised();
			context.emit(Transport.authenticationFailedEvent);
		} else {
			log.debug('Got unexpected message', call);
		}
	}
	oncloseOrError(context) {
		context.processNextState(new DisconnectedState());
		context.closeWebSocket();
		context.emit(Transport.connectFailedEvent);
	}
	exitState() {
		if(this.timeoutTimer) {
			clearTimeout(this.timeoutTimer);
		}
	}
}

class ConnectedState extends State {
	enterState(context) {
		context.connectSuccess();
		context.emit(Transport.connectedEvent);
	}
	oncloseOrError(context) {
		context.processNextState(new ReconnectState());
	}
	onmessage(context, call) {
		// got a message from the server
		log.debug('Got a message', call);
		context.emit(Transport.messageEvent, call);
	}
	sendMessage(context, message) {
		try {
			context.ws.send(message);
		} catch(error) {
			log.error(error);
			this.onerror(context);
		}
	}
	disconnect(context) {
		context.processNextState(new DisconnectingState());
	}
}

class ReconnectState extends State {
	enterState(context) {
		context.emit(Transport.reconnectingEvent);
		this.totalTime = 0;
		this.retryTime = 2000;
		this.retryTimer = null;
		this.retryConnection(context);
	}
	retryConnection(context) {
		log.debug('retryConnection');
		this.totalTime += this.retryTime;
		if(this.totalTime > 20000) {
			log.debug('Timed out retries');
			// tried to reconnect too many times give up
			context.processNextState(new DisconnectedState());
			context.closeWebSocket();
			context.emit(Transport.lostConnectionEvent);
		} else {
			log.debug('Will retry in', this.retryTime);
			// retry connecting to the server
			this.retryTimer = setTimeout(() => {
				log.debug('Trying to reopen websocket');
				this.retryTimer = null;
				context.openWebSocket();
			}, this.retryTime);
		}
	}
	oncloseOrError(context) {
		if(!this.retryTimer) {
			this.retryConnection(context);
		}
	}
	onopen(context) {
		if(this.retryTimer) {
			clearTimeout(this.retryTimer);
		}
		// reconnected - need to reauthenticate
		context.processNextState(new AuthenticatingState());
	}
}

class DisconnectingState extends State {
	enterState(context) {
		context.ws.send(JSON.stringify({ method: "remoteDisconnect", authToken: context.authToken, params: [context.clientId, true] }));
		context.closeWebSocket();
	}
	oncloseOrError(context) {
		context.processNextState(new DisconnectedState());
	}
	exitState(context) {
		context.emit(Transport.disconnectedEvent);
	}
}
/*eslint-enable no-use-before-define */

class Transport extends EventEmitter {
	constructor() {
		super();
		this.currentState = new DisconnectedState();
	}

	processNextState(state) {
		if(state) {
			log.debug('transition to new state', state.constructor.name);
			this.currentState.exitState(this);
			this.currentState = state;
			this.currentState.enterState(this);
		}
	}

	openWebSocket() {
		try {
			log.debug('Opening a websocket to', this.wsURI);
			this.ws = new WebSocket(this.wsURI);
			this.ws.onmessage = (event) => {
				this.currentState.onmessage(this, JSON.parse(event.data));
			};
			this.ws.onclose = () => {
				log.debug('Socket closed');
				this.currentState.oncloseOrError(this);
			};
			this.ws.onerror = () => {
				log.debug('Socket error');
				this.currentState.oncloseOrError(this);
			};
			this.ws.onopen = () => {
				log.debug('Socket open');
				this.currentState.onopen(this);
			};
		} catch(error) {
			console.error(error);
			this.currentState.onerror(this);
		}
	}

	closeWebSocket() {
		if(this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	connect(wsURI, authToken, clientId) {
		this.wsURI = wsURI;
		this.authToken = authToken;
		this.clientId = clientId;
		return new Promise((resolve, reject) => {
			this.connectPromise = { resolve, reject };
			this.currentState.connect(this);
		});
	}

	connectFailed() {
		if(this.connectPromise) {
			this.connectPromise.reject('Could not connect to the nodule server');
			this.connectPromise = null;
		}
	}

	connectSuccess() {
		if(this.connectPromise) {
			this.connectPromise.resolve();
			this.connectPromise = null;
		}
	}

	connectNotAuthorised() {
		console.log('authentication failed');
		if(this.connectPromise) {
			console.log('rejecting connect');
			this.connectPromise.reject(new Error('Authentication Failed'));
			this.connectPromise = null;
		}
		this.closeWebSocket();
	}

	disconnect() {
		this.currentState.disconnect(this);
	}

	send(message) {
		this.currentState.sendMessage(this, message);
	}
}

Transport.connectingEvent = 'connecting';
Transport.connectFailedEvent = 'connectFailed';
Transport.authenticatingEvent = 'authenticating';
Transport.authenticatedEvent = 'authenticated';
Transport.authenticationFailedEvent = 'authenticationFailed';
Transport.connectedEvent = 'connected';
Transport.messageEvent = 'message';
Transport.reconnectingEvent = 'reconnecting';
Transport.lostConnectionEvent = 'lostConnection';
Transport.disconnectedEvent = 'disconnected';

module.exports = Transport;
