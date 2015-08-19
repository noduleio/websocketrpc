'use strict';

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var WebSocket = require('./ws');
var log = require('./log');
var EventEmitter = require('events').EventEmitter;

var State = (function () {
	function State() {
		_classCallCheck(this, State);
	}

	/*eslint-disable no-use-before-define */

	_createClass(State, [{
		key: 'connect',
		value: function connect() {
			return null;
		}
	}, {
		key: 'disconnect',
		value: function disconnect() {
			return null;
		}
	}, {
		key: 'sendMessage',
		value: function sendMessage() {
			return null;
		}
	}, {
		key: 'enterState',
		value: function enterState() {
			return null;
		}
	}, {
		key: 'exitState',
		value: function exitState() {
			return null;
		}
	}, {
		key: 'onopen',
		value: function onopen() {
			return null;
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError() {
			return null;
		}
	}, {
		key: 'onmessage',
		value: function onmessage() {
			return null;
		}
	}]);

	return State;
})();

var DisconnectedState = (function (_State) {
	_inherits(DisconnectedState, _State);

	function DisconnectedState() {
		_classCallCheck(this, DisconnectedState);

		_get(Object.getPrototypeOf(DisconnectedState.prototype), 'constructor', this).apply(this, arguments);
	}

	_createClass(DisconnectedState, [{
		key: 'enterState',
		value: function enterState(context) {
			context.closeWebSocket();
		}
	}, {
		key: 'connect',
		value: function connect(context) {
			// switch into connecting state where we open the socket and wait for it to either open or fail
			context.processNextState(new ConnectingState());
		}
	}]);

	return DisconnectedState;
})(State);

var ConnectingState = (function (_State2) {
	_inherits(ConnectingState, _State2);

	function ConnectingState() {
		_classCallCheck(this, ConnectingState);

		_get(Object.getPrototypeOf(ConnectingState.prototype), 'constructor', this).apply(this, arguments);
	}

	_createClass(ConnectingState, [{
		key: 'enterState',
		value: function enterState(context) {
			context.emit(Transport.connectingEvent);
			context.openWebSocket();
		}
	}, {
		key: 'onopen',
		value: function onopen(context) {
			context.processNextState(new AuthenticatingState());
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError(context) {
			context.processNextState(new DisconnectedState());
			context.closeWebSocket();
			context.emit(Transport.connectFailedEvent);
		}
	}]);

	return ConnectingState;
})(State);

var AuthenticatingState = (function (_State3) {
	_inherits(AuthenticatingState, _State3);

	function AuthenticatingState() {
		_classCallCheck(this, AuthenticatingState);

		_get(Object.getPrototypeOf(AuthenticatingState.prototype), 'constructor', this).apply(this, arguments);
	}

	_createClass(AuthenticatingState, [{
		key: 'enterState',
		value: function enterState(context) {
			var _this = this;

			context.emit(Transport.authenticatingEvent);
			// request access to the sever with a 5 second timeout on the response
			try {
				context.ws.send(JSON.stringify({ method: "remoteConnect", authToken: context.authToken, params: [context.clientId] }));
			} catch (error) {
				this.onerror(context);
			}
			this.timeoutTimer = setTimeout(function () {
				_this.timeoutTimer = null;
				context.closeWebSocket();
			}, 5000);
		}
	}, {
		key: 'onmessage',
		value: function onmessage(context, call) {
			log.debug(call);
			if (call.method === 'connected') {
				// successfully authenticated
				context.emit(Transport.authenticatedEvent);
				context.processNextState(new ConnectedState());
			} else if (call.method === 'rejected') {
				// server doesn't like us - we are not authorized
				context.processNextState(new DisconnectedState());
				context.connectNotAuthorised();
				context.emit(Transport.authenticationFailedEvent);
			} else {
				log.debug('Got unexpected message', call);
			}
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError(context) {
			context.processNextState(new DisconnectedState());
			context.closeWebSocket();
			context.emit(Transport.connectFailedEvent);
		}
	}, {
		key: 'exitState',
		value: function exitState() {
			if (this.timeoutTimer) {
				clearTimeout(this.timeoutTimer);
			}
		}
	}]);

	return AuthenticatingState;
})(State);

var ConnectedState = (function (_State4) {
	_inherits(ConnectedState, _State4);

	function ConnectedState() {
		_classCallCheck(this, ConnectedState);

		_get(Object.getPrototypeOf(ConnectedState.prototype), 'constructor', this).apply(this, arguments);
	}

	_createClass(ConnectedState, [{
		key: 'enterState',
		value: function enterState(context) {
			context.connectSuccess();
			context.emit(Transport.connectedEvent);
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError(context) {
			context.processNextState(new ReconnectState());
		}
	}, {
		key: 'onmessage',
		value: function onmessage(context, call) {
			// got a message from the server
			if (call.method === 'rejected') {
				context.processNextState(new RejectedState());
			} else {
				log.debug('Got a message', call);
				context.emit(Transport.messageEvent, call);
			}
		}
	}, {
		key: 'sendMessage',
		value: function sendMessage(context, message) {
			try {
				context.ws.send(message);
			} catch (error) {
				log.error(error);
				this.onerror(context);
			}
		}
	}, {
		key: 'disconnect',
		value: function disconnect(context) {
			context.processNextState(new DisconnectingState());
		}
	}]);

	return ConnectedState;
})(State);

var ReconnectState = (function (_State5) {
	_inherits(ReconnectState, _State5);

	function ReconnectState() {
		_classCallCheck(this, ReconnectState);

		_get(Object.getPrototypeOf(ReconnectState.prototype), 'constructor', this).apply(this, arguments);
	}

	_createClass(ReconnectState, [{
		key: 'enterState',
		value: function enterState(context) {
			context.emit(Transport.reconnectingEvent);
			this.totalTime = 0;
			this.retryTime = 2000;
			this.retryTimer = null;
			this.retryConnection(context);
		}
	}, {
		key: 'retryConnection',
		value: function retryConnection(context) {
			var _this2 = this;

			log.debug('retryConnection');
			this.totalTime += this.retryTime;
			if (this.totalTime > 20000) {
				log.debug('Timed out retries');
				// tried to reconnect too many times give up
				context.processNextState(new DisconnectedState());
				context.closeWebSocket();
				context.emit(Transport.lostConnectionEvent);
			} else {
				log.debug('Will retry in', this.retryTime);
				// retry connecting to the server
				this.retryTimer = setTimeout(function () {
					log.debug('Trying to reopen websocket');
					_this2.retryTimer = null;
					context.openWebSocket();
				}, this.retryTime);
			}
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError(context) {
			if (!this.retryTimer) {
				this.retryConnection(context);
			}
		}
	}, {
		key: 'onopen',
		value: function onopen(context) {
			if (this.retryTimer) {
				clearTimeout(this.retryTimer);
			}
			// reconnected - need to reauthenticate
			context.processNextState(new AuthenticatingState());
		}
	}]);

	return ReconnectState;
})(State);

var RejectedState = (function (_State6) {
	_inherits(RejectedState, _State6);

	function RejectedState() {
		_classCallCheck(this, RejectedState);

		_get(Object.getPrototypeOf(RejectedState.prototype), 'constructor', this).apply(this, arguments);
	}

	_createClass(RejectedState, [{
		key: 'enterState',
		value: function enterState(context) {
			context.closeWebSocket();
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError(context) {
			context.processNextState(new DisconnectedState());
		}
	}, {
		key: 'exitState',
		value: function exitState(context) {
			context.emit(Transport.disconnectedEvent);
		}
	}]);

	return RejectedState;
})(State);

var DisconnectingState = (function (_State7) {
	_inherits(DisconnectingState, _State7);

	function DisconnectingState() {
		_classCallCheck(this, DisconnectingState);

		_get(Object.getPrototypeOf(DisconnectingState.prototype), 'constructor', this).apply(this, arguments);
	}

	/*eslint-enable no-use-before-define */

	_createClass(DisconnectingState, [{
		key: 'enterState',
		value: function enterState(context) {
			context.ws.send(JSON.stringify({ method: "remoteDisconnect", authToken: context.authToken, params: [context.clientId, true] }));
			context.closeWebSocket();
		}
	}, {
		key: 'oncloseOrError',
		value: function oncloseOrError(context) {
			context.processNextState(new DisconnectedState());
		}
	}, {
		key: 'exitState',
		value: function exitState(context) {
			context.emit(Transport.disconnectedEvent);
		}
	}]);

	return DisconnectingState;
})(State);

var Transport = (function (_EventEmitter) {
	_inherits(Transport, _EventEmitter);

	function Transport() {
		_classCallCheck(this, Transport);

		_get(Object.getPrototypeOf(Transport.prototype), 'constructor', this).call(this);
		this.currentState = new DisconnectedState();
	}

	_createClass(Transport, [{
		key: 'processNextState',
		value: function processNextState(state) {
			if (state) {
				log.debug('transition to new state', state.constructor.name);
				this.currentState.exitState(this);
				this.currentState = state;
				this.currentState.enterState(this);
			}
		}
	}, {
		key: 'openWebSocket',
		value: function openWebSocket() {
			var _this3 = this;

			try {
				log.debug('Opening a websocket to', this.wsURI);
				this.ws = new WebSocket(this.wsURI);
				this.ws.onmessage = function (event) {
					_this3.currentState.onmessage(_this3, JSON.parse(event.data));
				};
				this.ws.onclose = function () {
					log.debug('Socket closed');
					_this3.currentState.oncloseOrError(_this3);
				};
				this.ws.onerror = function () {
					log.debug('Socket error');
					_this3.currentState.oncloseOrError(_this3);
				};
				this.ws.onopen = function () {
					log.debug('Socket open');
					_this3.currentState.onopen(_this3);
				};
			} catch (error) {
				console.error(error);
				this.currentState.onerror(this);
			}
		}
	}, {
		key: 'closeWebSocket',
		value: function closeWebSocket() {
			if (this.ws) {
				this.ws.close();
				this.ws = null;
			}
		}
	}, {
		key: 'connect',
		value: function connect(wsURI, authToken, clientId) {
			var _this4 = this;

			this.wsURI = wsURI;
			this.authToken = authToken;
			this.clientId = clientId;
			return new Promise(function (resolve, reject) {
				_this4.connectPromise = { resolve: resolve, reject: reject };
				_this4.currentState.connect(_this4);
			});
		}
	}, {
		key: 'connectFailed',
		value: function connectFailed() {
			if (this.connectPromise) {
				this.connectPromise.reject('Could not connect to the nodule server');
				this.connectPromise = null;
			}
		}
	}, {
		key: 'connectSuccess',
		value: function connectSuccess() {
			if (this.connectPromise) {
				this.connectPromise.resolve();
				this.connectPromise = null;
			}
		}
	}, {
		key: 'connectNotAuthorised',
		value: function connectNotAuthorised() {
			if (this.connectPromise) {
				this.connectPromise.reject(new Error('Authentication Failed'));
				this.connectPromise = null;
			}
			this.closeWebSocket();
		}
	}, {
		key: 'disconnect',
		value: function disconnect() {
			this.currentState.disconnect(this);
		}
	}, {
		key: 'send',
		value: function send(message) {
			this.currentState.sendMessage(this, message);
		}
	}]);

	return Transport;
})(EventEmitter);

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