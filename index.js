var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var app = express();
var geocoder = require('geocoder');

var google_api_key ="AIzaSyDbhlnIkxUmb0cwIMCx34P9W2lGYYa-UFg"

var image_url = "https://i3.au.reastatic.net/800x600/a177a44afd7e9afe7ba30f5b63140f1fc46eff1f5b9e4cf0c9e77485e69208c4/main.jpg"


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
            var location = "";

            geocoder.reverseGeocode(lat,long,function(err, data){
              // data = google JSON formatted address
              var location = data.results[0].formatted_address;
              sendMessage(event.sender.id, {text: location})
              console.log(data);
            });

            sendGeneric(event.sender.id, location, image_url);
            console.log('worked');
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

function sendGeneric(recipientId, location, image_url){
  //https://developers.facebook.com/docs/messenger-platform/send-api-reference/generic-template
  request({
    url: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
    method: 'POST',
    json: {
      recipient: {id: recipientId},
      message: {attachment:{type:"template",
                            payload: {template_type:"generic",
                                      elements:[{title : location,
                                                item_url : image_url,
                                                subtitle : "Please check in",
                                                buttons: [{
                                                  type:"web_url",
                                                  url: "www.google.com",
                                                  title: "Check in"
                                                }]
                                              }]
                                            }
                                          }
                                        }
                                      }
  })
};
