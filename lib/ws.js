'use strict';

if (typeof WebSocket === 'undefined') {
	module.exports = require('ws');
} else {
	module.exports = WebSocket;
}