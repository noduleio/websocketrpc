'use strict';

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var log = require('./log');
var EventEmitter = require('events').EventEmitter;
var uuid = require('uuid');
var _ = require('lodash');
var Transport = require('./websocket_transport');

var Client = (function (_EventEmitter) {
	_inherits(Client, _EventEmitter);

	function Client(clientId) {
		_classCallCheck(this, Client);

		_get(Object.getPrototypeOf(Client.prototype), 'constructor', this).call(this);
		this.isConnected = false;
		this.clientId = clientId || uuid.v4();
	}

	_createClass(Client, [{
		key: 'connect',
		value: function connect(wsURI, authToken) {
			var _this = this;

			return new Promise(function (resolve, reject) {
				// already connected
				if (_this.isConnected) {
					resolve(true);
				}
				_this.pendingResults = {};
				_this.remoteObjects = {};
				_this.localObjects = {};
				_this.remoteDisconnectTimeouts = {};
				_this.isConnected = false;
				_this.connectPromise = { resolve: resolve, reject: reject };
				_this.disconnecting = false;
				_this.wsURI = wsURI;
				_this.authToken = authToken;
				_this.transport = new Transport();

				_this.transport.on(Transport.connectingEvent, function () {});
				_this.transport.on(Transport.connectFailedEvent, function () {});
				_this.transport.on(Transport.authenticatingEvent, function () {});
				_this.transport.on(Transport.authenticatedEvent, function () {});
				_this.transport.on(Transport.authenticationFailedEvent, function () {});
				_this.transport.on(Transport.messageEvent, function (call) {
					_this.processMessage(call);
				});
				_this.transport.on(Transport.reconnectingEvent, function () {});
				_this.transport.on(Transport.lostConnectionEvent, function () {
					_this.disconnected(false);
				});
				_this.transport.on(Transport.disconnectedEvent, function () {
					_this.disconnected(true);
				});

				log.debug('Going to call connect', _this.wsURI, _this.authToken, _this.clientId);
				_this.transport.connect(_this.wsURI, _this.authToken, _this.clientId).then(function () {
					_this.isConnected = true;
					resolve(true);
					_this.emit('connected');
					// handle reconnected events
					_this.transport.on(Transport.connectedEvent, function () {
						_.values(_this.localObjects).forEach(function (localObject) {
							var message = _.clone(localObject.registerMessage);
							_this.sendMessage(message);
						});
						_.values(_this.remoteObjects).forEach(function (remoteObject) {
							_.keys(remoteObject.eventHandlers).forEach(function (eventName) {
								if (remoteObject.eventHandlers[eventName] && remoteObject.eventHandlers[eventName].length > 0) {
									var message = {
										method: 'startEvents',
										params: [remoteObject.clientId, remoteObject.objId, eventName]
									};
									_this.sendMessage(message);
								}
							});
						});
					});
				}, function (error) {
					log.error('Tranport connect raised error', error);
					reject(error);
				});
			});
		}
	}, {
		key: 'processMessage',
		value: function processMessage(call) {
			var _this2 = this;

			this.emit('receivedMessage', call);
			if (call.method !== 'raiseEvent') {
				log.debug(call);
			}
			if (call.hasOwnProperty("result")) {
				var pendingResult = this.pendingResults[call.requestId];
				if (pendingResult) {
					this.pendingResults[call.requestId].resolve(call.result);
					delete this.pendingResults[call.requestId];
				}
			} else if (call.hasOwnProperty("error")) {
				if (pendingResult) {
					pendingResult.reject(new Error(call.error));
					delete this.pendingResults[call.requestId];
				}
			} else if (call.hasOwnProperty("objId")) {
				if (this.localObjects[call.objId]) {
					var localObject = this.localObjects[call.objId];
					if (localObject[call.method]) {
						log.debug('Calling method', call.method);
						localObject[call.method].apply(localObject, call.params).then(function (result) {
							log.debug('Replying success to', call.method, result);
							_this2.sendMessage({ requestId: call.requestId, objId: call.objId, result: result });
						}, function (error) {
							log.debug('Replying error to', call.method, error);
							_this2.sendMessage({ requestId: call.requestId, objId: call.objId, error: error.message });
						});
					} else {
						log.error('Unknown method', call);
					}
				}
			} else {
				if (this[call.method]) {
					this[call.method].apply(this, call.params);
				} else {
					log.error('Unknown method', call);
				}
			}
		}
	}, {
		key: 'sendMessage',
		value: function sendMessage(message) {
			if (this.transport) {
				if (this.clientId) {
					this.emit('sentMessage', message);
					message.clientId = this.clientId;
					this.transport.send(JSON.stringify(message));
				} else {
					log.error('No client id');
				}
			} else {
				log.error('No transport');
			}
		}
	}, {
		key: 'disconnect',
		value: function disconnect() {
			if (this.transport) {
				this.transport.disconnect();
				this.transport = null;
				this.isConnected = false;
			} else {
				this.disconnected(true);
			}
		}
	}, {
		key: 'disconnected',
		value: function disconnected(clean) {
			var _this3 = this;

			this.tranport = null;
			this.isConnected = false;
			_.values(this.localObjects).forEach(function (localObject) {
				delete localObject.raiseEvent;
			});
			this.localObjects = {};
			_.values(this.remoteObjects).forEach(function (remoteObject) {
				_this3.emit('remoteObjectRemoved', remoteObject);
			});
			this.remoteObjects = {};
			_.values(this.pendingResults).forEach(function (deadRequest) {
				deadRequest.reject(new Error('No connection'));
			});
			this.pendingResults = {};
			this.clientId = null;
			this.emit('disconnected', !clean);
		}
	}, {
		key: 'addLocalObject',
		value: function addLocalObject(localObject) {
			var self = this;
			var objId = localObject.objId || uuid.v4();
			this.localObjects[objId] = localObject;

			var functions = _.functions(localObject);

			if (localObject.privateMethods) {
				functions = _.without(functions, localObject.privateMethods);
			}
			functions = _.reject(functions, function (name) {
				return name.indexOf('_') === 0 || name.indexOf('$') === 0;
			});

			var propertyNames = _.without(_.keys(localObject), _.functions(localObject));
			propertyNames = _.reject(propertyNames, function (name) {
				return name.indexOf('_') === 0 || name.indexOf('$') === 0;
			});

			var properties = _.reduce(propertyNames, function (_properties, key) {
				_properties[key] = localObject[key];
				return _properties;
			}, {});

			localObject.registerMessage = {
				method: "registerRemoteObject",
				params: [this.clientId, objId, functions, properties]
			};
			localObject.raiseEvent = function () {
				var args = _.toArray(arguments);
				var eventName = args.shift();
				self.sendMessage({
					method: "raiseEvent",
					params: [self.clientId, objId, eventName, args]
				});
			};
			self.sendMessage(localObject.registerMessage);
		}
	}, {
		key: 'registerRemoteObject',
		value: function registerRemoteObject(clientId, objId, methods, properties) {
			if (this.remoteObjects[objId]) {
				log.debug('Already have remote object');
				return;
			}

			var remoteObj = this.remoteObjects[objId] || {};
			var self = this;
			_.reduce(methods, function (obj, method) {
				obj[method] = function () {
					var params = _.toArray(arguments);
					var promise = new Promise(function (resolve, reject) {
						var requestId = uuid.v4();
						self.pendingResults[requestId] = { resolve: resolve, reject: reject, clientId: clientId, requestId: requestId, method: method };
						self.sendMessage({
							toClientId: clientId,
							objId: objId,
							requestId: requestId,
							method: method,
							params: params
						});
					});
					return promise;
				};
				return obj;
			}, remoteObj);
			_.reduce(_.keys(properties), function (obj, property) {
				obj[property] = properties[property];
				return obj;
			}, remoteObj);
			remoteObj.eventHandlers = {};
			remoteObj.on = function (eventName, handler) {
				if (!remoteObj.eventHandlers[eventName]) {
					remoteObj.eventHandlers[eventName] = [];
				}
				remoteObj.eventHandlers[eventName].push(handler);
				if (remoteObj.eventHandlers[eventName].length === 1) {
					var message = {
						method: 'startEvents',
						params: [clientId, objId, eventName]
					};
					self.sendMessage(message);
				}
			};
			remoteObj.off = function (eventName, handler) {
				if (remoteObj.eventHandlers[eventName]) {
					remoteObj.eventHandlers[eventName] = _.without(remoteObj.eventHandlers[eventName], handler);
					if (remoteObj.eventHandlers[eventName].length === 0) {
						var message = {
							method: 'stopEvents',
							params: [clientId, objId, eventName]
						};
						self.sendMessage(message);
					}
				}
			};
			remoteObj.clientId = clientId;
			remoteObj.objId = objId;
			this.remoteObjects[objId] = remoteObj;
			this.emit('remoteObjectAdded', remoteObj);
		}
	}, {
		key: 'raiseEvent',
		value: function raiseEvent(clientId, objId, eventName, params) {
			var remoteObj = this.remoteObjects[objId];
			if (remoteObj) {
				var handlers = remoteObj.eventHandlers[eventName];
				if (handlers) {
					handlers.forEach(function (handler) {
						handler.apply(remoteObj, params);
					});
				}
			}
		}
	}, {
		key: 'remoteConnect',
		value: function remoteConnect(clientId) {
			var self = this;
			_.values(this.localObjects).forEach(function (localObject) {
				var message = _.clone(localObject.registerMessage);
				message.toClientId = clientId;
				self.sendMessage(message);
			});
			if (this.remoteDisconnectTimeouts[clientId]) {
				clearTimeout(this.remoteDisconnectTimeouts[clientId]);
				delete this.remoteDisconnectTimeouts[clientId];
			}
		}
	}, {
		key: 'remoteDisconnect',
		value: function remoteDisconnect(clientId, clean) {
			var _this4 = this;

			if (clean) {
				log.debug('Remote client disconnected', clientId, clean);
				// cancel any pending calls to the remote client
				_.values(this.pendingResults).filter(function (request) {
					return request.clientId === clientId;
				}).forEach(function (deadRequest) {
					log.debug('Cleaning up request', deadRequest.method);
					deadRequest.reject(new Error('Lost connection to client'));
					delete _this4.pendingResults[deadRequest.requestId];
				});
				// remove any objects that were registered by the remote client
				_.values(this.remoteObjects).filter(function (remoteObject) {
					return remoteObject.clientId === clientId;
				}).forEach(function (remoteObject) {
					_this4.emit('remoteObjectRemoved', remoteObject);
					delete _this4.remoteObjects[remoteObject.objId];
				});
			} else {
				// not a clean disconnect so give the remote object chance to reconnect
				this.remoteDisconnectTimeouts[clientId] = setTimeout(function () {
					delete _this4.remoteDisconnectTimeouts[clientId];
					_this4.remoteDisconnect(clientId, clean);
				}, 20000);
			}
		}
	}]);

	return Client;
})(EventEmitter);

module.exports = Client;