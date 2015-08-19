if(WebSocket) {
	module.exports = WebSocket;
} else {
	module.exports = require('ws');
}
