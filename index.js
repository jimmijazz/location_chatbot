// TO DO:
// Make Facebook graph call an async callback


var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var app = express();
var geocoder = require('geocoder');
var mongodb = require("mongodb");
var ObjectID = mongodb.ObjectID;

var CONTACTS_COLLECTION = "contacts";
var HOUSES_COLLECTION = "houses"; // Collection of availale houses to inspect

var google_api_key ="AIzaSyDbhlnIkxUmb0cwIMCx34P9W2lGYYa-UFg"

var image_url = "https://i3.au.reastatic.net/800x600/a177a44afd7e9afe7ba30f5b63140f1fc46eff1f5b9e4cf0c9e77485e69208c4/main.jpg"

app.use(express.static(__dirname + "/public"));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

// Create a database variable outside of the database connection callback to reuse the connection pool in your app.
var db;

//Connect to database before starting the application Server
mongodb.MongoClient.connect(process.env.MONGODB_URI, function (err, database) {
  if (err) {
    console.log('Unable to connect to the database. Error:',err);
    process.exit(1);
  }
  // Save database object from the vallback for reuse
  db = database;
  console.log("database connection ready");
})

// Initialize the app
app.listen((process.env.PORT || 3000));

// Server frontpage
app.get('/', function (req, res) {
  res.send('This is the ChatBot server');
});

// Facebook Webhook
app.get('/webhook', function( req, res){
  if(req.query['hub.verify_token'] === '1775479496065328') {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Invalid verify token');
  }
});

// handler receiving messages
app.post('/webhook', function (req, res) {
    var events = req.body.entry[0].messaging;
    var collection = db.collection(CONTACTS_COLLECTION);
    var houses_collection = db.collection(HOUSES_COLLECTION);
    var user = {}

    // Get Basic Facebook Graph Information
    request({
      url: 'https://graph.facebook.com/v2.6/'+event.sender.id+'?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=PAGE_ACCESS_TOKEN"',
      qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
      method: 'GET',

    }, function(error, response, body) {
      if (error) {
        console.log('Error: ', error);
      } else if (response.body.error) {
        console.log('Error: ', response.body.error);
      }
      // Convert FB response from string to object
      user = JSON.parse(response.body);

    });

    for (i = 0; i < events.length; i++) {
        var event = events[i];
        var message = {user_id:"", message_text: ""};
        sendMessage(event.sender.id, text:"hello" + user.first_name);





        // sendMessage(event.sender.id, {text: "hello" + user.first_name}));

        // Echo user message
        // if (event.message && event.message.text && !event.message.is_echo) {
        //   sendMessage(event.sender.id, {text: "Hello " + event.message.text});
        //   console.log('message sent to', event.sender.id);
        //   message = {
        //     user_id: event.sender.id,
        //     message_text: event.message.text,
        //     // first_name: user.first_name,
        //     // last_name: user["last_name"],
        //     // gender: user["gender"]
        //   };
        //
        //   // Add to database
        //   collection.insert(message, function(err, result) {
        //     if (err) {
        //       console.log("Error inserting message. Error:",err);
        //
        //     } else {
        //       console.log('Inserted documents into the "contacts" collection.', result);
        //     }
        //   })
        //
        //
        // } else if (event.message && event.message.attachments) {
        //     console.log("Event has attachments:", event.message.attachments);
        //     lat = event.message.attachments[0].payload.coordinates.lat;
        //     long = event.message.attachments[0].payload.coordinates.long;
        //
        //     geocoder.reverseGeocode(lat,long,function(err, data){
        //       // data = google JSON formatted address
        //       var location = data.results[0].formatted_address;
        //       sendMessage(event.sender.id, {text: location})
        //       console.log("Location sent","\n", data);
        //     });
        //
        //     console.log('worked');
        //   }
        };

    res.sendStatus(200);

  });

// Generic function sending messages
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

function userProfile(userId){
  // Returns dict of user profile
  // userProfile(str) -> dict(first_name:str,last_name:str,profile_pic:str,locale:str,timezone:int,gender:str)
  request({
    url: 'https://graph.facebook.com/v2.6/'+userId+'?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=PAGE_ACCESS_TOKEN"',
    qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
    method: 'GET',

  }, function(error, response, body) {
    if (error) {
      console.log('Error: ', error);
    } else if (response.body.error) {
      console.log('Error: ', response.body.error);
    }
    // Convert FB response from string to object
    var user = JSON.parse(response.body);

  })
  return user;
}
