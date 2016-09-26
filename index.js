// TO DO:
// Make Facebook graph call an async callback
// Create house locations

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const fetch = require('node-fetch');
const app = express();
const geocoder = require('geocoder');
const mongodb = require("mongodb");
const ObjectID = mongodb.ObjectID;

//Wit.Ai Parameters
const WIT_TOKEN = process.env.WIT_TOKEN;
let Wit = require('node-wit').Wit;
var log = require('node-wit').log;

// MongoDB Collections
var CONTACTS_COLLECTION = "contacts"; // All messages sent (probably won't need this)
var HOUSES_COLLECTION = "houses"; // Details of houses including whether or not they are open for inspection
var AGENTS = "agents;"  // Registered agents and which agency they are with
var PEOPLE = "people" // Potential vendors and tenants {_id: str, messages:[{"message":str, "timestamp": int, "mid": str, "seq": int}]}

var google_api_key ="AIzaSyDbhlnIkxUmb0cwIMCx34P9W2lGYYa-UFg";
var map_url = "https://maps.googleapis.com/maps/api/staticmap?maptype=satellite&center="

// ----------------------------------------------------------------------------
// MongoDB Specific Code

//Connect to database before starting the application Server
mongodb.MongoClient.connect(process.env.MONGODB_URI, function (err, database) {
  if (err) {
    console.log('Unable to connect to the database. Error:',err);
    process.exit(1);
  }
  // Save database object from the vallback for reuse
  db = database;
  console.log("database connection ready");
});

// ----------------------------------------------------------------------------
// Wit.ai bot specific code - https://github.com/wit-ai/node-wit/blob/master/examples/messenger.js
const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // See if we have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Bot actions
const actions = {
  send({sessionId}, {text}) {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // We found our recipient. Let's forward our bot response to them.
      // We return a promise to let our bot know when we're done sending
      return sendMessage(recipientId, {text:text});
      
    } else {
      console.error("Couldn't find user for session: ", sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
    }
  },
  // Wit.Ai Custom Actions

  getForecast({context, entities}) {
    return new Promise(function(resolve, reject) {
      context.forecast = 'sunny';
      return resolve(context);
    });
  },
};

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  actions
  //logger: new log.logger(log.INFO)
});



// Start our webserver
app.use(express.static(__dirname + "/public"));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

// Create a database variable outside of the database connection callback to reuse the connection pool in app.
var db;

// Server frontpage
app.get('/', function (req, res) {
  res.send('OpenHood 2016');
});

// Facebook webhook setup
app.get('/webhook', function( req, res){
  if(req.query['hub.verify_token'] === '1775479496065328') {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Invalid verify token');
  }
});

// Message handler
app.post('/webhook', function (req, res) {
    var events = req.body.entry[0].messaging;

    for (i = 0; i < events.length; i++) {
      var event = events[i];
      var id = event.sender.id;
      const sessionId = findOrCreateSession(id);

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
            sendMessage(id, {text: "I'm sorry something went wrong. I'm not sure who you are."});
        };

        user = JSON.parse(response.body); // Convert FB response from string to object

        // ** TEXT MESSAGE ** //
        if (event.message && event.message.text && !event.message.echo) {
            var msg_meta = {
                                "message" : event.message.text,
                                "timestamp" : event.timestamp,
                                "mid" : event.message.mid,
                                "seq" : event.message.seq
                            };

            // TO DO: Also add a check for 'seq' as a redundancy
            // See if a new user
            db.collection(PEOPLE).count({_id: id}, function(err, count) {
              if(count === 0) {
                console.log('*** New User ***');
                // 1. Insert user into database
                db.collection(PEOPLE).insert({_id:id, messages:[msg_meta]}, function(err, result) {
                  if (err) {
                    console.log("Error updating PEOPLE. Error: ", err);
                  } else {
                    console.log("Updated PEOPLE");
                  };
              });
              // 2. Check if is a registered agent
                db.collection(AGENTS).findOne({_id : id}, function (err, result) {
                  if (err) {
                    console.log("Error finding agent. Error: ",err);
                    // 3. Send message depending on if agent or not.
                  } else {
                    var welcome_msg = result ? "Welcome to Openhood Agent "+user.last_name : "Hi " + user.first_name + "😊 my name is Josh and I'm the dev working on Openhood. Openhood is going to assist real estate agents with creating open homes and marketing, but most of the responses won't be set up until later this week. Thank you for your interest!";
                    sendMessage(id, {text:welcome_msg});
                    };
                });

            // Not a new user. Update existing user's messages.
            } else {
                db.collection(PEOPLE).update({_id: id}, { $push: {messages: msg_meta}}, function(err, result){
                  if (err) {
                    console.log("Error updating msg_meta. Error: ", err);
                  } else {
                    console.log("Updated msg_meta");
                  };
                });

                // Forward the message to the Wit.ai Bot Engine
                // This will run all actions until our bot has nothing left to do
                wit.runActions(
                  sessionId, // the user's current session
                  event.message.text, // the user's message
                  sessions[sessionId].context // the user's current session state
                ).then((context) => {
                  // Our bot did everything it has to do.
                  // Not it's waiting for further messages to proceed.
                  console.log('Waiting for next user messages');

                  // Based on session state, might want to reset session.
                  // This depends havily on the business logic of the bot.
                  // Example:
                  // if (context['done']) {
                  // delete sessions[sessionId];
                  //   }
                  sessions[sessionId].context = context;
                })
                .catch((err) => {
                  console.error('Got an error from Wit: ', err.stack || err);
                })
              }
            })
          // ** LOCATION MESSAGE ** //
        } else if (event.message && event.message.attachments && event.message.attachments[0].type == 'location') {
            if (new_user(id)) {
              console.log("New User")
            } else {
              var lat = event.message.attachments[0].payload.coordinates.lat;
              var long = event.message.attachments[0].payload.coordinates.long;

              var agent = db.collection(AGENTS).find({"_id" : id});

              // Send Generic Message with location
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
          }
        });
    };
    res.sendStatus(200);
  });

function createInspection(id, address, time) {
  // Check if user is an agent

  // Double check with agent if address is correct

  // When would you like to schedule the inspection? (now, 10 minutes, in 1 hour)

  // Check if creating_inspection is true

  //
};

function finishInspection(id, address) {
  // Check if is an agent

  // Check if currently open for inspection

}


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
  if (db.collection(AGENTS).find({_id : id})) {
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
};

function read_message(id, user_message) {
// Sends a message to the user(id) based on message
/// read_message(str,str) -> None
  var msg = user_message.toLowerCase();
  switch(msg) {
    case "check in" :
      sendMessage(id, {text: "Please send your location"});
      break;

    case "what is my name" :
      sendMessage(id, {text: "Your name is " + user.first_name});
      break;

    case "create inspection" :
      if (isAgent(id)) {
        // Update agent status to creating inspection
        message = {_id:id, creating_inspection: true};

        db.collection(AGENTS).insert(message, function(err, result) {
          if (err) {
            console.log("Error updating agent. Error:", err);
          } else {
            console.log("Updated agent");
          };
        });
        sendMessage(id, {text:"Send your location to create an inspection"});
      };
      break;

    default :
      sendMessage(id, {text: "Sorry I don't understand what you mean by " + msg });
      break;

    // Add another statement to catch address
  };
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
        // Initialize the app
app.listen((process.env.PORT || 3000));
