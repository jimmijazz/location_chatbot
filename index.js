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
var HOUSES_COLLECTION = "houses"; // Details of houses including whether or not they are open for inspection
var AGENTS = "agents;"  // Registered agents and which agency they are with
var PEOPLE = "people" // Potential vendors and tenants {_id: str, messages:[{"message":str, "timestamp": int, "mid": str, "seq": int}]}

var google_api_key ="AIzaSyDbhlnIkxUmb0cwIMCx34P9W2lGYYa-UFg";
var map_url = "https://maps.googleapis.com/maps/api/staticmap?maptype=satellite&center="

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

    for (i = 0; i < events.length; i++) {
      var event = events[i];
      var id = event.sender.id;

      // Get Basic Facebook Graph Information
      // Nothing can happen until this returns info
      request({
        url: 'https://graph.facebook.com/v2.6/'+event.sender.id+'?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=PAGE_ACCESS_TOKEN"',
        qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
        method: 'GET',

      }, function(error, response, body) {
          if (error) {
            console.log('Error: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
            sendMessage(id, {text: "I'm sorry something went wrong. I'm not sure who you are"});
        }

        // Convert FB response from string to object
        user = JSON.parse(response.body);

        // If message is text
        if (event.message && event.message.text && !event.message.echo) {
            var msg = event.message.text.toLowerCase();

            var msg_meta = {"_id": id, "messages" : [{
                                "message" : event.message.text,
                                "timestamp" : event.timestamp,
                                "mid" : event.message.mid,
                                "seq" : event.message.seq
                            }]};

            db.collection(PEOPLE).insert(msg_meta, function(err, result){
              if (err) {
                console.log("Error updating msg_meta. Error: ", err);
              } else {
                console.log("Updated msg_meta");
              };
            };
            // Check if user has interacted with us before

                // Check if user is registered agent or not

            // Check if user is agent


            // Check if user has
            // Send message depending on input
            switch(msg) {
              case "check in" :
                sendMessage(id, {text: "Please send your location"});
                break;

              case "what is my name" :
                sendMessage(id, {text: "Your name is " + user.first_name});
                break;

              case "create inspection" :
                if (isAgent(id)) {
                  sendMessage(id, {text:"Send your location to create an inspection"});
                };
                break;

              default :
                sendMessage(id, {text: "Sorry I don't understand what you mean by " + msg });
                break;

              // Add another statement to catch address
            };

        };

        // If location sent
        if (event.message && event.message.attachments && event.message.attachments[0].type == 'location') {
            // Handle locations
            lat = event.message.attachments[0].payload.coordinates.lat;
            long = event.message.attachments[0].payload.coordinates.long;

            if isAgent(id) {
              // Return create check in
            }

            var agent = db.collection(AGENTS).find({"_id" : id});
            //console.log("Event has attachments:", event.message.attachments);


            geocoder.reverseGeocode(lat,long,function(err, data){
              // data = google JSON formatted address
              var location = data.results[0].formatted_address;
              // Get static image of location
              var location_image = map_url + lat + "," + long + "&zoom=" + 20 + "&size=640x400&key=" + google_api_key;
              var payload = [{
                "title" : "Your Property",
                "subtitle" : location,
                "image_url" : location_image,
                "buttons" : [{
                  "type" : "postback",
                  "title" : "Create Location",
                  "payload" : "hello hello hello",
                }],
              }];

              sendGenericMessage(id, payload );
              console.log("Location sent","\n", data);
            });

            console.log('worked');
          }

        });
    };

    //     var message = {user_id:"", message_text: ""};
    //     sendMessage(event.sender.id, {text:"hello" + user.first_name});

        // Echo user message
        // if (event.message && event.message.text && !event.message.is_echo) {
          // sendMessage(event.sender.id, {text: "Hello " + event.message.text});
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
        console.log(body);
    });
};


function isAgent(id) {
// Checks to see if user is an agent.
// If TRUE puts them into create inspection mode.
  // Check the user is allowed to create a location. Replace with DB lookup
  if (db.collection(AGENTS).find({"_id" : id})) {
    // Update agent status to creating inspection
    message = {"_id":id, "creating_inspection": true}
    db.collection(AGENTS).insert(message, function(err, result) {
      if (err) {
        console.log("Error updating agent. Error:", err);
      } else {
        console.log("Updated agent");
      };
    });
    return true;
  } else {
    return false;
  };

  // Check if it is a location

  // If not location check if it is an address

  // Else return error message "not an address"
};

function userProfile(userId){
  // Returns dict of user profile
  // userProfile(str) -> dict(first_name:str,last_name:str,profile_pic:str,locale:str,timezone:int,gender:str)
  return request({
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
};


function sendGenericMessage(sender, payload) {
	var messageData = {
		"attachment": {
			"type": "template",
			"payload": {
				"template_type": "generic",
				"elements": payload
			}
		}
	};

	request({
		url: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {access_token:process.env.PAGE_ACCESS_TOKEN},
		method: 'POST',
		json: {
			recipient: {id:sender},
			message: messageData,
		}
	}, function(error, response, body) {
		if (error) {
			console.log('Error sending messages: ', error)
		} else if (response.body.error) {
			console.log('Error: ', response.body.error)
		}
	})
}
