import express from "express"; //import express framework

import bodyParser from "body-parser";

export const app = express(); // creates a server

app.use(bodyParser.json()); 

interface Balances {
    [key: string]: number;
}

interface User {
    id: string;
    balances: Balances;
}

interface Order {
    userId: string;
    price: number;
    quantity: number;
}

export const TICKER = "TATA"; //it can be an array for multiple markets

const users: User[] = [{     //dummy user objects
    id: "1",
    balances: {
        "TATA": 10,
        "USD": 50000
    }
}, {
    id: "2",
    balances: {
        "TATA": 10,
        "USD": 50000
    }
}];   

const bids: Order[] = [];       //storing in memory rather than a database for low latency
const asks: Order[] = [];

//Place a limit order when the user hits the order endpoint
app.post("/order", (req: any, res: any) => {
  const side: string = req.body.side;
  const price: number = req.body.price;
  const quantity: number = req.body.quantity;
  const userId: string = req.body.userId;

  const remainingQty = fillOrders(side, price, quantity, userId);  //tries to fill orders

  if (remainingQty === 0) { //checks if qty was fully filled
    res.json({ filledQuantity: quantity }); 
    return;
  }

  if (side === "bid") { //bid i.e. buy order
    bids.push({
      userId,
      price,
      quantity: remainingQty
    });
    bids.sort((a, b) => a.price < b.price ? -1 : 1);  //Higher price = higher priority
  } else {
    asks.push({
      userId,
      price,
      quantity: remainingQty
    })
    asks.sort((a, b) => a.price < b.price ? 1 : -1);  //lower price = higher priority
  }

  res.json({ 
    filledQuantity: quantity - remainingQty, // returns how much qty actually matched 
  })
})

app.get("/depth", (req: any, res: any) => {
  const depth: {
    [price: string]: {
      type: "bid" | "ask",
      quantity: number,
    }
  } = {};

  //Loops through bids, If price not seen → create entry, If seen → add quantities, Groups all buy orders by price
  for (let i = 0; i < bids.length; i++) {  
    if (!depth[bids[i].price]) {
      depth[bids[i].price] = {
        quantity: bids[i].quantity,
        type: "bid"
      };
    } else {
      depth[bids[i].price].quantity += bids[i].quantity;
    }
  }

  for (let i = 0; i < asks.length; i++) {  //Same loop for sell orders
    if (!depth[asks[i].price]) {
      depth[asks[i].price] = {
        quantity: asks[i].quantity,
        type: "ask"
      }
    } else {
      depth[asks[i].price].quantity += asks[i].quantity;
    }
  }

  res.json({  //Sends response
    depth
  })
})

app.get("/balance/:userId", (req, res) => {  //This endpoint returns a user’s balance.
  const userId = req.params.userId;
  const user = users.find(x => x.id === userId);  //Searches the users array for that user
  if (!user) {
    return res.json({
      USD: 0,
      [TICKER]: 0
    })
  }
  res.json({ balances: user.balances });  //If user exists, returns their actual balances
})

app.get("/quote", (req, res) => {
  // TO DO: Fix the problem of backend going down
});

//transfers assets and money between two users after a trade
function flipBalance(userId1: string, userId2: string, quantity: number, price: number) {
  let user1 = users.find(x => x.id === userId1); //seller
  let user2 = users.find(x => x.id === userId2); //buyer
  if (!user1 || !user2) {   //safety check
    return;
  }
  user1.balances[TICKER] -= quantity;  //seller loses assets
  user2.balances[TICKER] += quantity;  //buyer gains assets
  user1.balances["USD"] += (quantity * price);  //seller gets money
  user2.balances["USD"] -= (quantity * price);  //buyer pays money
}

//matches a buy order with sell orders and returns unfilled quantity
function fillOrders(side: string, price: number, quantity: number, userId: string): number {
  let remainingQuantity = quantity;  //what’s left to fill
  if (side === "bid") {                            //logic for buy orders
    for (let i = asks.length - 1; i >= 0; i--) {
      if (asks[i].price > price) {  //Skip asks that are too expensive
        continue;
      }
      if (asks[i].quantity > remainingQuantity) {  //One ask can fully fill the order
        asks[i].quantity -= remainingQuantity;
        flipBalance(asks[i].userId, userId, remainingQuantity, asks[i].price);
        return 0;   //Order fully filled
      } else {      //Ask is fully consumed
        remainingQuantity -= asks[i].quantity;
        flipBalance(asks[i].userId, userId, asks[i].quantity, asks[i].price);
        asks.pop();  //Remove filled ask order
      }
    }
  } else {   //Handles a sell order(ask)
    for (let i = bids.length - 1; i >= 0; i--) {
      if (bids[i].price < price) {  //Skip buyers offering less than seller’s price
        continue;
      }
      if (bids[i].quantity > remainingQuantity) {  //One bid can fully buy the sell order
        bids[i].quantity -= remainingQuantity;
        flipBalance(userId, bids[i].userId, remainingQuantity, price);
        return 0;
      } else {  //Buyer order fully consumed
        remainingQuantity -= bids[i].quantity;
        flipBalance(userId, bids[i].userId, bids[i].quantity, price);
        bids.pop();
      }
    }
  }

  return remainingQuantity;
}