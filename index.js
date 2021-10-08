const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server, { cors: { origin: "*" } });
const mysql = require("mysql");
const cors = require("cors");
const { start } = require("repl");
const { STATUS_CODES } = require("http");

app.use(cors());
app.use(express.json());

const PORT = 3003;

// MySQL
/*
const db = mysql.createConnection({
  user: "root",
  host: "localhost",
  password: "",
  database: "crashDB",
});
*/
/*
const db = mysql.createConnection({
  user: "b593a65c9e1759",
  host: "eu-cdbr-west-01.cleardb.com",
  password: "472746a6",
  database: "heroku_049da53785a2cd2",
});
*/
//mysql://b593a65c9e1759:472746a6@eu-cdbr-west-01.cleardb.com/heroku_049da53785a2cd2?reconnect=true
//mysql://ua4j8py5112tcm5l:zqyg6r72m4qddga6@c8u4r7fp8i8qaniw.chr7pe7iynqr.eu-west-1.rds.amazonaws.com:3306/di7n5bty34jjodl7

const db = mysql.createConnection({
  user: "ua4j8py5112tcm5l",
  host: "c8u4r7fp8i8qaniw.chr7pe7iynqr.eu-west-1.rds.amazonaws.com",
  password: "zqyg6r72m4qddga6",
  database: "di7n5bty34jjodl7",
});

app.post("/create", (req, res) => {
  const address = req.body.address;
  const username = req.body.username;

  if (address !== "" && username !== "") {
    db.query(
      "INSERT INTO players (address, username) VALUES (?,?)",
      [address, username],
      (err, result) => {
        if (err) {
          console.log(err);
        } else {
          res.send("Values insterted.");
        }
      }
    );
  }
});

app.post("/check", (req, res) => {
  const address = req.body.address;
  db.query(
    "SELECT COUNT(*) AS addressCnt FROM players WHERE address = ?",
    address,
    (err, result) => {
      res.send(result);
    }
  );
});

app.post("/username", (req, res) => {
  const address = req.body.address[0];
  db.query(
    "SELECT username FROM players WHERE address = ?",
    address,
    (err, result) => {
      res.send(result);
    }
  );
});

app.post("/chat", (req, res) => {
  const address = req.body.address;
  const username = req.body.username;
  const message = req.body.message;

  if (address !== "" && username !== "" && message != "") {
    db.query(
      "INSERT INTO messages (address, username, message) VALUES (?,?,?)",
      [address, username, message],
      (err, result) => {
        if (err) {
          console.log(err);
        } else {
          res.send("Values insterted.");
        }
      }
    );
  }
});

var initialResult;
db.query(
  "SELECT * FROM (SELECT id, username, message FROM messages ORDER BY id DESC LIMIT 50) lastNrows ORDER BY id",
  (err, result) => {
    initialResult = result;
    io.sockets.emit("messaging", initialResult);
  }
);

// chat socket
setInterval(() => {
  db.query(
    "SELECT * FROM (SELECT id, username, message FROM messages ORDER BY id DESC LIMIT 50) lastNrows ORDER BY id",
    (err, result) => {
      if (changed(initialResult, result)) {
        io.sockets.emit("messaging", result);
      } else {
        initialResult = result;
      }
      function changed(pre, now) {
        if (pre === now) {
          return false;
        } else {
          return true;
        }
      }
    }
  );
}, 1000);

server.listen(process.env.PORT || PORT, () => {
  console.log(`Server running on port ${PORT}.`);
});

// Times
var crashedTime = 3000; // time between crash and starting a new game
var bettingTime = 5000; // time between starting a new game and playing
var playingTime = 5000; // just temp

let state = "CRASHED"; // 'BETTING', 'PLAYING', 'CRASHED'

let tick = 0;

let chartArray = [];
let gameEndDate;
let gameEndDateSafety;
let startTime;

var resultTableArray = [];

const roundStartTimes = [];
var bettingTimeOut = 60000; // betting's timeframe

let balance; // balance of game's wallet

io.sockets.emit("everyPlayer", resultTableArray);

function growthFunc(ms) {
  return 0.005 * ms;
}
var sendTime;

io.on("connection", (socket) => {
  socket.on("resultTableUserData", (receivedUserData) => {
    if (includesUser(resultTableArray, receivedUserData.user)) {
      resultTableArray = resultTableArray.filter(
        (item) => item.name !== receivedUserData.name
      );
    }
    resultTableArray.push(receivedUserData);
    io.sockets.emit("everyPlayer", resultTableArray);
  });
  io.sockets.emit("everyPlayer", resultTableArray);

  socket.emit("currentState", state);
  socket.emit("startData", roundStartTimes[roundStartTimes.length - 1]);
  socket.emit("calculatedCrashPoint", calculateCrashPoint(playingTime));
  socket.emit("chartArray", chartArray);
  socket.emit("endData", gameEndDate);
  socket.emit("bettingTime", Date(bettingTime));
  socket.emit("gameStartTime", sendTime);
});

setInterval(() => {
  io.sockets.emit("serverTime", Date.now());
}, 1000);

// web3 connection
const Web3 = require("web3");
const CrashToken = require("./CrashToken.json");
const web3 = new Web3(
  new Web3.providers.HttpProvider(
    "https://data-seed-prebsc-1-s1.binance.org:8545"
  )
);

let tokenAddress = "0x42F90f64d449cB0435d73aBa79801ae8C56d43AC";
let walletAddress = "0x4854Ebc0E6a0e81555d220f2Fc1FD4cc775397D9"; // game's wallet
let contract = new web3.eth.Contract(CrashToken.abi, tokenAddress);

async function getBalance() {
  balance = await contract.methods.balanceOf(walletAddress).call();
  return balance;
}

let betAmountSum = +0; // users who bet

// game's state machine
function Game() {
  io.emit("currentState", state);
  startBetting();

  io.on("connection", (socket) => {
    socket.on("betAmountOfUser", (receivedBet) => {
      betAmountSum += receivedBet;

      console.log("SUM BET: ", betAmountSum);
    });
  });

  function startBetting() {
    const bettingTime = Date.now();
    io.emit("bettingTime", Date(bettingTime));
    sendTime = Date.now() + bettingTimeOut;
    io.emit("gameStartTime", sendTime);
    chartArray = [];
    tick = 0;
    resultTableArray = [];

    state = "BETTING";
    io.emit("currentState", state);
    getBalance().then(function (result) {
      balance = web3.utils.fromWei(result, "ether");
      console.log("balance: ", balance);
    });
    setTimeout(startPlaying, bettingTimeOut);
  }

  function startPlaying() {
    chartArray = [];
    state = "PLAYING";
    playingTime = generateCrashPoint();
    startTime = Date.now();
    roundStartTimes.push(Date(startTime));
    gameEndDate = new Date(startTime + playingTime);

    io.emit("currentState", state);
    io.emit("startData", roundStartTimes[roundStartTimes.length - 1]);

    if (betAmountSum === 0) {
      gameEndDateSafety = gameEndDate;
    } else {
      gameEndDateSafety = new Date(
        startTime + safetyTime(betAmountSum, balance)
      );
    }

    if (gameEndDateSafety < gameEndDate) {
      io.emit("endData", gameEndDateSafety);
      io.emit("calculatedCrashPoint", safetyMultiplier(betAmountSum, balance));
      playingTime = safetyTime(betAmountSum, balance);
      console.log("gameEndDateSafety: ", gameEndDateSafety);
    } else {
      io.emit("endData", gameEndDate);
      io.emit("calculatedCrashPoint", calculateCrashPoint(playingTime));
      console.log("gameEndDate: ", gameEndDate);
    }

    runGame(crash);
    setTimeout(crash, playingTime);
  }

  function crash() {
    state = "CRASHED";
    betAmountSum = +0;
    io.emit("currentState", state);
    chartArray = [];

    setTimeout(startBetting, crashedTime);
  }
}

function generateCrashPoint() {
  return Math.floor(Math.random() * 100000);
}

function calculateCrashPoint(playingTime) {
  return Math.exp((0.005 * playingTime) / 100).toFixed(2);
}

function safetyTime(betSum, balance) {
  const multiplier = (balance * 0.5) / betSum;
  return 20000 * Math.log(multiplier);
}

function safetyMultiplier(betSum, balance) {
  return ((balance * 0.5) / betSum).toFixed(2);
}

Game();

function runGame() {
  setInterval(() => {
    elapsed = new Date() - startTime;
    tick = elapsed / 100;
    if (state === "PLAYING") {
      chartArray.push({
        x: growthFunc(tick),
        y: Math.exp(growthFunc(tick)),
      });
    }
  }, 1000);
}

function includesUser(array, user) {
  for (var i = 0; i < array.length; i++) {
    if (array[i].user === user) {
      return true;
    }
  }
  return false;
}
