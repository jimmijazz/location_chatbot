var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var app = express();

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 3000));

// Server frontpage
app.get('/', function (req, res) {
  res.send('This is the ChatBot server');
});

// Facebook Webhook
app.get('/webhook', function( req, res){
  if(req.query['hub.verify_token'] === 'chatbot_verify_token') {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Invalid verify token');
  }
});

// Handler recieving messages
app.post('/webhook', function (req, res) {
  var events = req.body.entry[0].messaging; // messaging is a property of the req tha tbatches the entire text sent
  for (i = 0; i < events.length; i++) {
    var event = events[i];
    if (event.message && event.message.attachments) {
      lat = event.message.attachments[0].payload.coordinates.lat;
      long = event.message.attachments[0].payload.coordinates.long;

      sendMessage(event.sender.id, {text: "Your location is" + lat + " " + long});
  }
}

  res.sendStatus(200);
});

// generic function sending messages
function sendMessage(recipientId, message) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: recipientId},
            message: message,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    });
};
