var WebSocket = require('ws');
var WebSocketServer = WebSocket.Server
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

module.exports = class Server {
  constructor(options) {
    this.wss = null;
    this.connectedClients = {};
    this.clustered = options.clustered;
    this.authenticate = options.authenticate;
    if(this.clustered) {
      this.subscriberClient = createRedisClient();
      this.publishClient = createRedisClient();
      this.subscriberClient.on("message", (messageQueueName, messageJSON) => {
        this.sendToClients(messageQueueName, messageJSON);
      });
    }
  };

  broadcast(messageQueueName, messageJSON) {
    if(this.clustered) {
      this.publishClient.publish(messageQueueName, messageJSON);
    } else {
      this.sendToClients(messageQueueName, messageJSON);
    }
  };

  subscribe(messageQueueName) {
    if(this.clustered) {
      this.subscriberClient.subscribe(messageQueueName);
    }
  }

  unsubscribe(messageQueueName) {
    if(this.clustered) {
      this.subscriberClient.unsubscribe(messageQueueName);
    }
  }

  sendToClients(messageQueueName, messageJSON) {
    var clients = this.connectedClients[messageQueueName];
    if (clients) {
      var message = JSON.parse(messageJSON);
      if(message.method == '_killtoken') {
        clients.forEach((client) => {
          if (client.apiToken == message.apiToken) {
            client.send(JSON.stringify({ method: 'rejected', params: [] }))
            client.messageQueueName = null;
            client.close();
          }
        });
      } else {
        var toClientId = message.toClientId;
        clients.forEach((client) => {
          if (toClientId) {
            if (client.readyState === WebSocket.OPEN && client.clientId === toClientId) {
              client.send(messageJSON);
              client.lastMessageSent = Date.now();
            }
          } else if (client.readyState === WebSocket.OPEN && client.clientId !== message.clientId) {
            if (message.method != 'raiseEvent' || (message.method == 'raiseEvent' && client.eventFilter[message.params[0] + "-" + message.params[1] + "-" + message.params[2]])) {
              client.send(messageJSON);
              client.lastMessageSent = Date.now();
            }
          }
        });
      }
    }
  };

  start(options) {
    this.pingInterval = setInterval(function() {
        try {
            _.values(connectedClients).forEach(function (connectedClients) {
                connectedClients.forEach(function(client) {
                    if ((Date.now() - client.lastMessageReceived) > 5000) {
                        client.ping('ping', {}, true);
                    }
                });
            });
        } catch(error) {
            console.log(error);
        }
    }, 10000);

    this.wss = new WebSocketServer(options);
    this.wss.on('connection', (ws) => {
      ws.on('pong', function () {
        ws.lastMessageReceived = Date.now();
      });

      ws.on('message', (messageJSON) => {
        ws.lastMessageReceived = Date.now();
        var message = JSON.parse(messageJSON);
        if (message.method == 'startEvents') {
          ws.eventFilter[message.params.join("-")] = true;
        } else if (message.method == 'stopEvents') {
          delete ws.eventFilter[message.params.join("-")];
        } else if (message.method !== 'ping') {
          if (message.method === 'remoteConnect') {
            var authToken = message.authToken;
            this.authenticate(authToken).then((token) => {
              var messageQueueName = 'MessageQueue' + token.userId;
              if (!this.connectedClients[messageQueueName]) {
                this.connectedClients[messageQueueName] = [];
                this.subscribe(messageQueueName);
              }
              ws.disconnecting = false;
              ws.messageQueueName = messageQueueName;
              ws.clientId = message.params[0];
              ws.eventFilter = {};
              ws.apiToken = token.apiToken;
              this.connectedClients[messageQueueName].push(ws);
              delete(message.authToken);
              messageJSON = JSON.stringify(message);
              this.broadcast(messageQueueName, messageJSON);
              ws.send(JSON.stringify({ method: 'connected', params: [] }))
            }, (error) => {
              ws.send(JSON.stringify({ method: 'rejected', params: [] }))
              ws.disconnecting = true;
              ws.close();
            });
          } else if (message.method == 'remoteDisconnect') {
            ws.disconnecting = true;
            if(ws.messageQueueName) {
              this.broadcast(ws.messageQueueName, messageJSON);
            }
          } else if(ws.messageQueueName) {
            this.broadcast(ws.messageQueueName, messageJSON);
          }
        }
      });

      ws.on('close', () => {
        var clients = this.connectedClients[ws.messageQueueName];
        if (clients) {
          this.connectedClients[ws.messageQueueName] = _.without(clients, ws);
          if (this.connectedClients[ws.messageQueueName].length === 0) {
            this.unsubscribe(ws.messageQueueName);
            this.connectedClients[ws.messageQueueName] = null;
            delete this.connectedClients[ws.messageQueueName];
          }
          if (!ws.disconnecting) {
            this.broadcast(ws.messageQueueName, JSON.stringify({
              method: 'remoteDisconnect',
              messageQueueName: ws.messageQueueName,
              params: [ws.clientId, false]
            }));
          }
        }
      });
      
      ws.on('error', function () {
        console.log('Got an error on the websocket');
      })
    });
  }

  stop() {
    if(this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if(this.clustered) {
      this.publishClient.quit();
      this.subscriberClient.quit();
    }
    this.wss.close();
  }
};
