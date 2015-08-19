var expect    = require("chai").expect;
var Server = require('../src/server');
var RPC = require('../src/client');

function createRPCClient(authToken) {
  return new Promise((resolve, reject) => {
    var rpc = new RPC();
    rpc.connect('ws://localhost:8765', authToken || 'valid_auth_token').then(function() {
      resolve(rpc);
    }, function(error) {
      reject(error);
    });
  });
}

describe("websocket_rpc", function() {
  var server = null;
  beforeEach(function() {
    // dummy authentication function
    function authenticate(json_web_token) {
      return new Promise((resolve, reject) => {
        if(json_web_token === 'valid_auth_token') {
          resolve({ userId: 'test_1', apiToken: '123' });
        } else {
          reject();
        }
      });
    }
    server = new Server({ authenticate: authenticate });
    server.start({ port: 8765 });
  });

  afterEach(function() {
    server.stop();
  });

  it("rejects invalid auth tokens", function(done) {
    createRPCClient('invalid_auth_token').then((rpc) => {
      expect(true).to.be.false;
      done();
    }, (error) => {
      done();
    });
  });

  it("kills connections that are invalidated", function(done) {
    createRPCClient().then((rpc) => {
      console.log('connected rpc client')
      setTimeout(function() {
        server.sendToClients('MessageQueuetest_1', JSON.stringify({ method : '_killtoken', apiToken : '123' }));
      }, 200);
      
      rpc.on('disconnected', function(isError) {
        console.log('rpc dicsonnected');
        done();
      });
    }, (error) => {
      done();
    });    
  })

  it("connects, authenticates and disconnects cleanly", function(done) {
    createRPCClient().then((rpc) => {
      setTimeout(function() {
        rpc.disconnect();
      }, 100);
      rpc.on('disconnected', function(isError) {
        expect(isError).to.be.false;
        done();
      });
    }, (error) => {
      done(error);
    });
  });

  it("connects, authenticates and disconnects two clients cleanly", function(done) {
    var rpc1Done = false;
    var rpc2Done = false;

    createRPCClient().then((rpc1) => {
      setTimeout(function() {
        rpc1.disconnect();
      }, 100);
      rpc1.on('disconnected', function(isError) {
        expect(isError).to.be.false;
        rpc1Done=true;
        if(rpc1Done && rpc2Done) {
          done();
        }
      });
    }, function(error) {
      done(error);
    });

    createRPCClient().then((rpc2) => {
      setTimeout(function() {
        rpc2.disconnect();
      }, 100);
      rpc2.on('disconnected', function(isError) {
        expect(isError).to.be.false;
        rpc2Done=true;
        if(rpc1Done && rpc2Done) {
          done();
        }
      });
    }, function(error) {
      done(error);
    });

  });

  it("connects, authenticates and registers a local object", function(done) {
    var rpc1Done = false;
    var rpc2Done = false;

    createRPCClient().then((rpc1) => {
      rpc1.on('remoteObjectAdded', function(remoteObject) {
        console.log("********* remote object added to rpc1");
      });
      rpc1.addLocalObject({
        property1: 'value1',
        property2: 'value2',
        method1: function(a) { return new Promise((resolve, reject) => { resolve("hello " + a); }); },
        method2: function(a,b) { return new Promise((resolve, reject) => { resolve(a+"-"+b); }); }
      });
      setTimeout(function() {
        rpc1.disconnect();
      }, 100);
      rpc1.on('disconnected', function(isError) {
        expect(isError).to.be.false;
        rpc1Done=true;
        if(rpc1Done && rpc2Done) {
          done();
        }
      });
    }, function(error) {
      console.log("************ error");
      done(error);
    });

    var rpc2 = new RPC();
    rpc2.on('disconnected', function(isError) {
      expect(isError).to.be.false;
      rpc2Done=true;
      if(rpc1Done && rpc2Done) {
        done();
      }
    });
    rpc2.on('remoteObjectAdded', function(remoteObject) {
      console.log("********* remote object added to rpc2");
      expect(remoteObject.property1).to.equal('value1');
      expect(remoteObject.property2).to.equal('value2');
      remoteObject.method1("bob").then(function(result) {
        expect(result).to.equal("hello bob");
        remoteObject.method2("a", "b").then(function(result) {
          expect(result).to.equal("a-b");
          rpc2.disconnect();
        })
      })
    });
    rpc2.connect('ws://localhost:8765', 'valid_auth_token').then(function() {
      console.log("******* rpc2 connected");
    }, function(error) {
      done(error);
    });
  });
});
