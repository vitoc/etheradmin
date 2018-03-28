var express = require('express');
var exphbs = require('express-handlebars');
var session = require('express-session');
var bodyParser = require('body-parser');
var fs = require('fs');
var dns = require('dns');
var Web3 = require('web3');
var moment = require('moment');
var Promise = require('promise');
var DocumentDBClient = require('documentdb').DocumentClient;
var basicAuth = require('express-basic-auth');

/*
 * Parameters
 */
var listenPort = process.argv[2]
var gethIPCPath = process.argv[3];
var coinbase = process.argv[4];
var coinbasePw = process.argv[5];
var consortiumId = process.argv[6];
var registrarHostEndpoint = process.argv[7];
var registrarConnectionString = process.argv[8];
var registrarDatatbaseId = process.argv[9];
var registrarCollectionId = process.argv[10];
var basicAdminPassword = process.argv[11];

/*
 * Constants
 */
var gethRPCPort = "8545";
var refreshInterval = 10000;
var web3IPC = new Web3(new Web3.providers.IpcProvider(gethIPCPath, require('net')));
var docDBClient = new DocumentDBClient(registrarHostEndpoint, {masterKey: registrarConnectionString});
var collectionLink = "dbs/" + registrarDatatbaseId + "/colls/" + registrarCollectionId;

var app = express();

app.use(basicAuth({
  users: { 'admin': basicAdminPassword },
  challenge: true
}));
app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({extended: true}));
app.use(session({
  secret: coinbasePw,
  resave: false,
  saveUninitialized: true
}))

var activeNodes = [];
var nodeInfoArray = [];
var timeStamp;

/*
 * Bug in DocumentDB lib fails to handle socket disconnect
 * Exception cannot be caught in try/catch
 * Catch at process level to prevent crashing service
 */
process.on('uncaughtException', err => { if (err.message.includes("ECONNRESET")) { console.log(err); } else throw err; });
process.on('unhandledRejection', err => { if (err.message.includes("ECONNRESET")) { console.log(err); } else throw err; });

/* 
 * Given a node hostname, collect node information (Consortium Id, PeerCount, Latest Block #) 
 */
function getNodeInfo(hostName, ipAddress) {
  return new Promise(function (resolve, reject){
    try {
      var web3RPC = new Web3(new Web3.providers.HttpProvider("http://" + ipAddress + ":" + gethRPCPort));
    }
    catch(err) {
      console.log(err);
    }
    var web3PromiseArray = [];
    web3PromiseArray.push(new Promise(function(resolve, reject) {
      web3RPC.net.getPeerCount(function(error, result) {
        if(!error)
        {
          resolve(result);
        }
        else {
          resolve("Not running");
        }
      });
    }));
    web3PromiseArray.push(new Promise(function(resolve, reject) {
      web3RPC.eth.getBlockNumber(function(error, result) {
        if(!error)
        {
          resolve(result);
        }
        else {
          resolve("Not running");
        }
      });
    }));

    Promise.all(web3PromiseArray).then(function(values){
      var peerCount = values[0];
      var blockNumber = values[1];      
      var nodeInfo = {
        hostname: hostName,
        peercount: peerCount,
        blocknumber: blockNumber,
        consortiumid: consortiumId
      };
      resolve(nodeInfo);
    });
  });
}

function getNodesInfo() {
  console.time("getNodesInfo");
  var queryNodesPromise = queryActiveNodes();
  try{
  queryNodesPromise.then(
    function(docs) {
    // Update active node list
      var newActiveNodes = [];
      for (var i = 0; i < docs.length; i++) {
        newActiveNodes.push(docs[i]);
      }
      activeNodes = newActiveNodes;
  })
  .catch(
    (reason) => {
      console.log(reason);
    });
  }catch(err){
    console.log(err);
  }
  
  if (activeNodes.length > 0) {
    console.time("queried active nodes");
    var promiseArray = [];

    for(var i = 0; i < activeNodes.length; i++) {
      promiseArray.push(getNodeInfo(activeNodes[i].hostname, activeNodes[i].ipaddress));
    }

    Promise.all(promiseArray).then(function(values) {
      nodeInfoArray = [];
      var arrLen = values.length;
      for(var i = 0; i< arrLen; ++i) {
        nodeInfoArray.push(values[i]);
      }

      // sort in alphabetical order
      nodeInfoArray = nodeInfoArray.sort();

      timeStamp = moment().format('h:mm:ss A UTC,  MMM Do YYYY');
      console.timeEnd("getNodesInfo");
      // Schedule next refresh
      // Schedule next refresh
      setTimeout(getNodesInfo, refreshInterval);
    });
  }
  else {
    setTimeout(getNodesInfo, refreshInterval);
  }
}

// Query docDB for the registered nodes
function queryActiveNodes() {  
  return new Promise((resolve, reject) => {    
    console.time("queryActiveNodes");
    var queryIterator = docDBClient.readDocuments(collectionLink).toArray(function (err, docs) {      
      console.timeEnd("queryActiveNodes");
      if (err) {
        console.log(err);    
        reject(err)
      } else {
          resolve(docs);         
      }
    });
  });
}

// Kick-off refresh cycle
getNodesInfo();

// Check if we've mined a block yet
function minedABlock () {
  var result = nodeInfoArray.filter(function(item) {
    return item.blocknumber > 0;
  });

  return result.length > 0;
}

app.get('/', function (req, res) {
  // Check if the IPC endpoint is up and running
  if(fs.existsSync(gethIPCPath)) {
    var hasNodeRows = nodeInfoArray.length > 0;
	
	web3IPC.eth.getBalance(
		coinbase, 
		function(err, result)
		{ 
			var balance = web3IPC.fromWei(result, "ether");
			console.log(coinbase + ": " + result)

      var data = { isSent: req.session.isSent, error: req.session.error, hasNodeRows: hasNodeRows, myAddress: coinbase, myBalance: balance, consortiumid: consortiumId, nodeRows: nodeInfoArray, minedABlock: minedABlock(), timestamp: timeStamp, refreshinterval: (refreshInterval/1000) };
			req.session.isSent = false;
			req.session.error = false;
			res.render('etheradmin', data);
		});	
  }
  else {
    res.render('etherstartup');
  }
});

app.post('/', function(req, res) {
  var address = req.body.etherAddress;
  var amount = req.body.amount;

  if(web3IPC.isAddress(address)) {
    web3IPC.personal.unlockAccount(coinbase, coinbasePw, function(err, res) {
      console.log(res);
      web3IPC.eth.sendTransaction({from: coinbase, to: address, value: web3IPC.toWei(amount, 'ether')}, function(err, res){ console.log(address)});
    });

    req.session.isSent = true;
  } else {
    req.session.error = "Not a valid Ethereum address";
  }

  res.redirect('/');
});

app.listen(listenPort, function () {
  console.log('Admin webserver listening on port ' + listenPort);
});
