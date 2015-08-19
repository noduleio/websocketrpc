var log = require('./log');
var EventEmitter = require('events').EventEmitter;
var uuid = require('uuid');
var _ = require('lodash');
var Transport = require('./websocket_transport');


class Client extends EventEmitter {
	constructor(clientId) {
		super();
		this.isConnected = false;
		this.clientId = clientId || uuid.v4();
	}

	connect(wsURI, authToken) {
		return new Promise((resolve, reject) => {
			// already connected
			if(this.isConnected) {
				resolve(true);
			}
			this.pendingResults = {};
			this.remoteObjects = {};
			this.localObjects = {};
			this.remoteDisconnectTimeouts = {};
			this.isConnected = false;
			this.connectPromise = { resolve, reject };
			this.disconnecting = false;
			this.wsURI = wsURI;
			this.authToken = authToken;
			this.transport = new Transport();

			this.transport.on(Transport.connectingEvent, () => {
			});
			this.transport.on(Transport.connectFailedEvent, () => {
			});
			this.transport.on(Transport.authenticatingEvent, () => {
			});
			this.transport.on(Transport.authenticatedEvent, () => {
			});
			this.transport.on(Transport.authenticationFailedEvent, () => {
			});
			this.transport.on(Transport.messageEvent, (call) => {
				this.processMessage(call);
			});
			this.transport.on(Transport.reconnectingEvent, () => {
			});
			this.transport.on(Transport.lostConnectionEvent, () => {
				this.disconnected(false);
			});
			this.transport.on(Transport.disconnectedEvent, () => {
				this.disconnected(true);
			});

			log.debug('Going to call connect', this.wsURI, this.authToken, this.clientId);
			this.transport.connect(this.wsURI, this.authToken, this.clientId).then(() => {
				this.isConnected = true;
				resolve(true);
				this.emit('connected');
				// handle reconnected events
				this.transport.on(Transport.connectedEvent, () => {
					_.values(this.localObjects).forEach((localObject) => {
						var message = _.clone(localObject.registerMessage);
						this.sendMessage(message);
					});
					_.values(this.remoteObjects).forEach((remoteObject) => {
						_.keys(remoteObject.eventHandlers).forEach((eventName) => {
							if(remoteObject.eventHandlers[eventName] && remoteObject.eventHandlers[eventName].length > 0) {
								var message = {
									method: 'startEvents',
									params: [remoteObject.clientId, remoteObject.objId, eventName]
								};
								this.sendMessage(message);
							}
						});
					});
				});
			}, (error) => {
				log.error('Tranport connect raised error', error);
				reject(error);
			});
		});
	}

	processMessage(call) {
		this.emit('receivedMessage', call);
		if(call.method !== 'raiseEvent') {
			log.debug(call);
		}
		if(call.hasOwnProperty("result")) {
			var pendingResult = this.pendingResults[call.requestId];
			if(pendingResult) {
				this.pendingResults[call.requestId].resolve(call.result);
				delete this.pendingResults[call.requestId];
			}
		} else if(call.hasOwnProperty("error")) {
			if(pendingResult) {
				pendingResult.reject(new Error(call.error));
				delete this.pendingResults[call.requestId];
			}
		} else if(call.hasOwnProperty("objId")) {
			if(this.localObjects[call.objId]) {
				var localObject = this.localObjects[call.objId];
				if(localObject[call.method]) {
					log.debug('Calling method', call.method);
					localObject[call.method].apply(localObject, call.params).then(
						(result) => {
							log.debug('Replying success to', call.method, result);
							this.sendMessage({ requestId: call.requestId, objId: call.objId, result: result });
						}, (error) => {
							log.debug('Replying error to', call.method, error);
							this.sendMessage({ requestId: call.requestId, objId: call.objId, error: error.message });
						});
				} else {
					log.error('Unknown method', call);
				}
			}
		} else {
			if(this[call.method]) {
				this[call.method].apply(this, call.params);
			} else {
				log.error('Unknown method', call);
			}
		}
	}

	sendMessage(message) {
		if(this.transport) {
			if(this.clientId) {
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

	disconnect() {
		if(this.transport) {
			this.transport.disconnect();
			this.transport = null;
			this.isConnected = false;
		} else {
			this.disconnected(true);
		}
	}

	disconnected(clean) {
		this.tranport = null;
		this.isConnected = false;
		_.values(this.localObjects).forEach((localObject) => {
			delete localObject.raiseEvent;
		});
		this.localObjects = {};
		_.values(this.remoteObjects).forEach((remoteObject) => {
			this.emit('remoteObjectRemoved', remoteObject);
		});
		this.remoteObjects = {};
		_.values(this.pendingResults).forEach((deadRequest) => {
			deadRequest.reject(new Error('No connection'));
		});
		this.pendingResults = {};
		this.clientId = null;
		this.emit('disconnected', !clean);
	}

	addLocalObject(localObject) {
		var self = this;
		var objId = localObject.objId || uuid.v4();
		this.localObjects[objId] = localObject;

		var functions = _.functions(localObject);

		if(localObject.privateMethods) {
			functions = _.without(functions, localObject.privateMethods);
		}
		functions = _.reject(functions, function(name) { return name.indexOf('_') === 0 || name.indexOf('$') === 0; });

		var propertyNames = _.without(_.keys(localObject), _.functions(localObject));
		propertyNames = _.reject(propertyNames, function(name) { return name.indexOf('_') === 0 || name.indexOf('$') === 0; });

		var properties = _.reduce(propertyNames, function(_properties, key) {
			_properties[key] = localObject[key];
			return _properties;
		}, {});

		localObject.registerMessage = {
			method: "registerRemoteObject",
			params: [
				this.clientId,
				objId,
				functions,
				properties ]
		};
		localObject.raiseEvent = function() {
			var args = _.toArray(arguments);
			var eventName = args.shift();
			self.sendMessage({
				method: "raiseEvent",
				params: [self.clientId, objId, eventName, args]
			});
		};
		self.sendMessage(localObject.registerMessage);
	};

	registerRemoteObject(clientId, objId, methods, properties) {
		if(this.remoteObjects[objId]) {
			log.debug('Already have remote object');
			return;
		}

		var remoteObj = this.remoteObjects[objId] || {};
		var self = this;
		_.reduce(methods, function(obj, method) {
			obj[method] = function() {
				var params = _.toArray(arguments);
				var promise = new Promise((resolve, reject) => {
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
		_.reduce(_.keys(properties), function(obj, property) {
			obj[property] = properties[property];
			return obj;
		}, remoteObj);
		remoteObj.eventHandlers = {};
		remoteObj.on = function(eventName, handler) {
			if(!remoteObj.eventHandlers[eventName]) {
				remoteObj.eventHandlers[eventName] = [];
			}
			remoteObj.eventHandlers[eventName].push(handler);
			if(remoteObj.eventHandlers[eventName].length === 1) {
				var message = {
					method: 'startEvents',
					params: [clientId, objId, eventName]
				};
				self.sendMessage(message);
			}
		};
		remoteObj.off = function(eventName, handler) {
			if (remoteObj.eventHandlers[eventName]) {
				remoteObj.eventHandlers[eventName] = _.without(remoteObj.eventHandlers[eventName], handler);
				if(remoteObj.eventHandlers[eventName].length === 0) {
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
	};

	raiseEvent(clientId, objId, eventName, params) {
		var remoteObj = this.remoteObjects[objId];
		if(remoteObj) {
			var handlers = remoteObj.eventHandlers[eventName];
			if(handlers) {
				handlers.forEach((handler) => {
					handler.apply(remoteObj, params);
				});
			}
		}
	}

	remoteConnect(clientId) {
		var self = this;
		_.values(this.localObjects).forEach((localObject) => {
			var message = _.clone(localObject.registerMessage);
			message.toClientId = clientId;
			self.sendMessage(message);
		});
		if(this.remoteDisconnectTimeouts[clientId]) {
			clearTimeout(this.remoteDisconnectTimeouts[clientId]);
			delete this.remoteDisconnectTimeouts[clientId];
		}
	};

	remoteDisconnect(clientId, clean) {
		if(clean) {
			log.debug('Remote client disconnected', clientId, clean);
			// cancel any pending calls to the remote client
			_.values(this.pendingResults)
			.filter((request) => { return request.clientId === clientId; })
			.forEach((deadRequest) => {
				log.debug('Cleaning up request', deadRequest.method);
				deadRequest.reject(new Error('Lost connection to client'));
				delete this.pendingResults[deadRequest.requestId];
			});
			// remove any objects that were registered by the remote client
			_.values(this.remoteObjects)
			.filter((remoteObject) => {
				return remoteObject.clientId === clientId;
			})
			.forEach((remoteObject) => {
				this.emit('remoteObjectRemoved', remoteObject);
				delete this.remoteObjects[remoteObject.objId];
			});
		} else {
			// not a clean disconnect so give the remote object chance to reconnect
			this.remoteDisconnectTimeouts[clientId] = setTimeout(() => {
				delete this.remoteDisconnectTimeouts[clientId];
				this.remoteDisconnect(clientId, clean);
			}, 20000);
		}
	}
}

module.exports = Client;
