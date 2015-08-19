'use strict';

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var WebSocket = require('ws');
var WebSocketServer = WebSocket.Server;
var _ = require('lodash');
var log = require('./log');

function createRedisClient() {
  if (process.env.REDISTOGO_URL) {
    var rtg = require("url").parse(process.env.REDISTOGO_URL);
    var redis = require("redis").createClient(rtg.port, rtg.hostname);
    redis.auth(rtg.auth.split(":")[1]);
    return redis;
  }
  return require("redis").createClient();
}

module.exports = (function () {
  function Server(options) {
    var _this = this;

    _classCallCheck(this, Server);

    this.wss = null;
    this.connectedClients = {};
    this.clustered = options.clustered;
    this.authenticate = options.authenticate;
    if (this.clustered) {
      this.subscriberClient = createRedisClient();
      this.publishClient = createRedisClient();
      this.subscriberClient.on("message", function (messageQueueName, messageJSON) {
        _this.sendToClients(messageQueueName, messageJSON);
      });
    }
  }

  _createClass(Server, [{
    key: 'broadcast',
    value: function broadcast(messageQueueName, messageJSON) {
      if (this.clustered) {
        this.publishClient.publish(messageQueueName, messageJSON);
      } else {
        this.sendToClients(messageQueueName, messageJSON);
      }
    }
  }, {
    key: 'subscribe',
    value: function subscribe(messageQueueName) {
      if (this.clustered) {
        this.subscriberClient.subscribe(messageQueueName);
      }
    }
  }, {
    key: 'unsubscribe',
    value: function unsubscribe(messageQueueName) {
      if (this.clustered) {
        this.subscriberClient.unsubscribe(messageQueueName);
      }
    }
  }, {
    key: 'sendToClients',
    value: function sendToClients(messageQueueName, messageJSON) {
      var clients = this.connectedClients[messageQueueName];
      if (clients) {
        var message = JSON.parse(messageJSON);
        if (message.method == '_killtoken') {
          clients.forEach(function (client) {
            if (client.apiToken == message.apiToken) {
              client.send(JSON.stringify({ method: 'rejected', params: [] }));
              client.messageQueueName = null;
              client.close();
            }
          });
        } else {
          var toClientId = message.toClientId;
          clients.forEach(function (client) {
            if (toClientId) {
              if (client.readyState === WebSocket.OPEN && client.clientId === toClientId) {
                client.send(messageJSON);
                client.lastMessageSent = Date.now();
              }
            } else if (client.readyState === WebSocket.OPEN && client.clientId !== message.clientId) {
              if (message.method != 'raiseEvent' || message.method == 'raiseEvent' && client.eventFilter[message.params[0] + "-" + message.params[1] + "-" + message.params[2]]) {
                client.send(messageJSON);
                client.lastMessageSent = Date.now();
              }
            }
          });
        }
      }
    }
  }, {
    key: 'start',
    value: function start(options) {
      var _this2 = this;

      this.pingInterval = setInterval(function () {
        try {
          _.values(connectedClients).forEach(function (connectedClients) {
            connectedClients.forEach(function (client) {
              if (Date.now() - client.lastMessageReceived > 5000) {
                client.ping('ping', {}, true);
              }
            });
          });
        } catch (error) {
          console.log(error);
        }
      }, 10000);

      this.wss = new WebSocketServer(options);
      this.wss.on('connection', function (ws) {
        ws.on('pong', function () {
          ws.lastMessageReceived = Date.now();
        });

        ws.on('message', function (messageJSON) {
          ws.lastMessageReceived = Date.now();
          var message = JSON.parse(messageJSON);
          if (message.method == 'startEvents') {
            ws.eventFilter[message.params.join("-")] = true;
          } else if (message.method == 'stopEvents') {
            delete ws.eventFilter[message.params.join("-")];
          } else if (message.method !== 'ping') {
            if (message.method === 'remoteConnect') {
              var authToken = message.authToken;
              _this2.authenticate(authToken).then(function (token) {
                var messageQueueName = 'MessageQueue' + token.userId;
                if (!_this2.connectedClients[messageQueueName]) {
                  _this2.connectedClients[messageQueueName] = [];
                  _this2.subscribe(messageQueueName);
                }
                ws.disconnecting = false;
                ws.messageQueueName = messageQueueName;
                ws.clientId = message.params[0];
                ws.eventFilter = {};
                ws.apiToken = token.apiToken;
                _this2.connectedClients[messageQueueName].push(ws);
                delete message.authToken;
                messageJSON = JSON.stringify(message);
                _this2.broadcast(messageQueueName, messageJSON);
                ws.send(JSON.stringify({ method: 'connected', params: [] }));
              }, function (error) {
                ws.send(JSON.stringify({ method: 'rejected', params: [] }));
                ws.disconnecting = true;
                ws.close();
              });
            } else if (message.method == 'remoteDisconnect') {
              ws.disconnecting = true;
              if (ws.messageQueueName) {
                _this2.broadcast(ws.messageQueueName, messageJSON);
              }
            } else if (ws.messageQueueName) {
              _this2.broadcast(ws.messageQueueName, messageJSON);
            }
          }
        });

        ws.on('close', function () {
          var clients = _this2.connectedClients[ws.messageQueueName];
          if (clients) {
            _this2.connectedClients[ws.messageQueueName] = _.without(clients, ws);
            if (_this2.connectedClients[ws.messageQueueName].length === 0) {
              _this2.unsubscribe(ws.messageQueueName);
              _this2.connectedClients[ws.messageQueueName] = null;
              delete _this2.connectedClients[ws.messageQueueName];
            }
            if (!ws.disconnecting) {
              _this2.broadcast(ws.messageQueueName, JSON.stringify({
                method: 'remoteDisconnect',
                messageQueueName: ws.messageQueueName,
                params: [ws.clientId, false]
              }));
            }
          }
        });

        ws.on('error', function () {
          console.log('Got an error on the websocket');
        });
      });
    }
  }, {
    key: 'stop',
    value: function stop() {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      if (this.clustered) {
        this.publishClient.quit();
        this.subscriberClient.quit();
      }
      this.wss.close();
    }
  }]);

  return Server;
})();