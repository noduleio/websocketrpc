if(typeof(window) == 'undefined') {
	var bunyan = require('bunyan');
	module.exports = bunyan.createLogger({
		name: 'nodule', 
		streams : [
			{
				level: 'info',
				stream: process.stdout,
			},
			{
      			level: 'debug',
	      		path: 'nodule.log'  // log ERROR and above to a file
    		}
    	]
	});
} else {
	module.exports = {
		warn: function() { console.warn.apply(console, arguments); },
		error: function() { console.error.apply(console, arguments); },
		debug: function() { console.debug.apply(console, arguments); }
	};
}
