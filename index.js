var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var app = express();
var geocoder = require('geocoder');

var google_api_key ="AIzaSyDbhlnIkxUmb0cwIMCx34P9W2lGYYa-UFg"

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

// handler receiving messages
app.post('/webhook', function (req, res) {
    var events = req.body.entry[0].messaging;
    for (i = 0; i < events.length; i++) {
        var event = events[i];
        if (event.message && event.message.text) {
            sendMessage(event.sender.id, {text: "Echo: " + event.message.text});
          } else if (event.message && event.message.attachments) {

            lat = event.message.attachments[0].payload.coordinates.lat;
            long = event.message.attachments[0].payload.coordinates.long;

            geocoder.reverseGeocode(lat,long,function(err, data){
              var location = data;
            });

            sendMessage(event.sender.id, {text: data})
          } else {
            console.log('Error');
          };
        };
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
