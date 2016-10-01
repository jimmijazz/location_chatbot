// TO DO:
// Make Facebook graph call an async callback
// Create house locations
// Use fbMessage over SendMessage
// Show how a person could query about a house

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const fetch = require('node-fetch');
const app = express();
const geocoder = require('geocoder');
const mongodb = require("mongodb");
const ObjectID = mongodb.ObjectID;

// Google Maps
var google_api_key ="AIzaSyDbhlnIkxUmb0cwIMCx34P9W2lGYYa-UFg";
var map_url = "https://maps.googleapis.com/maps/api/staticmap?maptype=satellite&center=";

// ----------------------------------------------------------------------------
// Wit.Ai Parameters
// We use two different bots so that if the user is an agent they will have
// additional options available to them such as creating inspections.
const WIT_TOKEN = process.env.WIT_TOKEN;
const WIT_TOKEN_AGENT = process.env.WIT_TOKEN_AGENT;
let Wit = require('node-wit').Wit;
var log = require('node-wit').log;


const firstEntityValue = (entities, entity) => {
    const val = entities && entities[entity] &&
            Array.isArray(entities[entity]) &&
            entities[entity].length > 0 &&
            entities[entity][0].value
        ;
    if (!val) {
        return null;
        console.log(entity + " entity not found")
    }
    return typeof val === 'object' ? val.value : val;
};



// ----------------------------------------------------------------------------
// MongoDB Specific Code

// MongoDB Collections
var CONTACTS_COLLECTION = "contacts"; // All messages sent (probably won't need this)
var PROPERTIES = "properties"; // Details of houses including whether or not they are open for inspection
var AGENTS = "agents;"  // Registered agents and which agency they are with
var PEOPLE = "people" // Potential vendors and tenants {_id: str, messages:[{"message":str, "timestamp": int, "mid": str, "seq": int}]}
var INSPECTIONS = "inspections" // List of inspections

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
    recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // We found our recipient. Let's forward our bot response to them.
      // We return a promise to let our bot know when we're done sending
      return fbMessage(recipientId, text)
      .then(() => null)
      .catch((err) =>{
        console.error(
          'An error occurred while forwarding the response to',
          recipientId,
          ':',
          err.stack || err
        );
      });
    } else {
      console.error("Couldn't find user for session: ", sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
    }
  },

  // Wit.Ai Custom Actions
  createInspection({context, entities}) {
    // Used by agent to create an inspection at a property

    // TO DO
    // - add a function to handle multiple datetimes detected (error)
    // - Add an "is this correct?" function to confirm
    // - check if inspection exists or not
    // - Get length of inspection and set expireat date to that
    return new Promise(function(resolve, reject) {
      var address = firstEntityValue(entities, "location");
      var time = firstEntityValue(entities, "datetime");

      // Split date into YEAR, MONTH, DAY, HOURS & MIN
      var year = time.substring(0,4);
      var month = time.substring(5,7);
      var day = time.substring(8,10);
      var hours = time.substring(11,13);
      var minutes = time.substring(14,16);
      // Convert hours to 12 hour time
      var suffix = hours >= 12 ? "PM":"AM";
      hours = (hours > 12) ? hours - 12 : hours;
      hours = (hours == '00')? 12 : hours;  // if 00 then it is 12 am

      if (address && time) {

        // Geocode Address
        geocoder.geocode(address, function(err, data){
          if(err) {
            console.log("Error geocoding inspection location" + err);
          } else {
              // Add to database of inspections
              db.collection(INSPECTIONS).insert({
                "_id": data.results[0].place_id, // ID returned by Gmaps
                // When inspection will finish
                "expireAt" : new Date('September 28, 2016 11:54:00'),
                "address" : data.results[0].formatted_address, // From Gmaps
              }, function(err, result) {
                  if(err) {
                    console.log(err);
                  }
              });
              // Send response back to wit.ai
              context.inspection = "Created inspection at "+ address +
                                    " at " + hours + ":" + minutes + suffix;
            }
          });

        delete context.address;
        delete context.time;

      } else if (!address) {
        console.log(" No address");
        context.address = true;
        delete context.address;
      } else if (!time) {
        console.log(" No time");
        context.time = true;
        delete context.time;
      }
      return resolve(context);
    });
  },

  // Used by agent to create an inspection at a property
  createProperty({context, entities}) {
    return new Promise(function(resolve, reject) {
      var address = firstEntityValue(entities, "location");

      if (address) {
        // Geocode address
        geocoder.geocode(address + "Australia", function(err, data) {
          if(err) {
            console.log("Error geocoding property location" + err);
          } else {
            address = data.results[0].formatted_address;
            // Add to property database
            db.collection(PROPERTIES).insert({
                "_id" : data.results[0].place_id,
                "address" : data.results[0].formatted_address,
                "lat" : data.results[0].geometry.location.lat,
                "lng" : data.results[0].geometry.location.lng
              }, function(err, result) {
                if(err) {
                  console.log(err);
                }
              });
              context.property = "Created property at " + address + ".";
          }
        });
        delete context.address;
      } else if (!address) {
        console.log("No address provided");
        context.address = true;
        delete context.address;
      }
      return resolve(context);
    });
  },

  // Sends a generic template message for the user to check into that property
  checkIn({context, entities}) {
    return new Promise(function(resolve, reject) {

      var address = firstEntityValue(entities, "location");

      if (address) {
        // Geocode address
        geocoder.geocode(address + "Australia", function(err, data) {
          if (err) {
            console.log("Error geocoding property location" + err);
          } else {
            let address = data.results[0];
            // If in inspection send generic view with option to check in
            var inspecting = db.collection(INSPECTIONS).findOne({"_id" : address.place_id }, function(err, result) {
                if (err) {
                  console.log("Error finding inspection. Error: " + err);
                } else if (result) {
                    db.collection(PROPERTIES).findOne({"_id" : address.place_id}, function(err, prop_result) {
                      if (err) {
                        console.log("Error finding property. Error: " + err);
                      } else {
                          payload = [{
                            "title" : address.formatted_address,
                            "subtitle" : prop_result.description,
                            "image_url" : prop_result.photos[0],
                            "buttons" : [{
                              "type" : "postback",
                              "title" : "Check In",
                              "payload" : "hello hello hello",
                            }]
                          }]
                          console.log(recipientId)
                          sendGenericMessage(actions.recipientId, payload);
                        }
                  })
                }
              })
            }
          });

            // Else if property is in properties collection send more info

            // Else send a list of close by properties

        delete context.address;

      } else if (!address){
        // Probably not needed because Wit.Ai will only call this function if it
        // detects a location but will help with user flow later on.
        console.log("No address provided");
        delete context.address;
      }
      return resolve(context);
    })
  },



};

// Wit.Ai Access. One for vendors, one for agents.
// Vendor Bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  actions
  //logger: new log.logger(log.INFO)
});

// Agent Bot
const wit_agent = new Wit({
  accessToken: WIT_TOKEN_AGENT,
  actions
});

// ----------------------------------------------------------------------------
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
              // Check if the user is an agent
              db.collection(AGENTS).findOne({_id : id}, function (err, result) {
                if (err) {
                  console.log("Error finding agent. Error: ",err);
                } else if (result){
                  // Forward the message to the Wit.ai Bot Engine
                  // This will run all actions until our bot has nothing left to do
                  wit_agent.runActions(
                    sessionId, // the user's current session
                    event.message.text, // the user's message
                    sessions[sessionId].context // the user's current session state
                  ).then((context) => {
                      // Our bot did everything it has to do.
                      // Now it's waiting for further messages to proceed.
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

                } else {
                  // Not an agent
                    wit.runActions(
                      sessionId,
                      event.message.text,
                      sessions[sessionId].context
                    ).then((context) => {
                      console.log('Waiting for next user messages');
                      sessions[sessionId].context = context;
                    })
                    .catch((err) => {
                      console.error('Got an error from Wit: ', err.stack || err);
                    })
                }
              });
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

// Generic function sending messages
const fbMessage = (id, text) => {
  const body = JSON.stringify({
    recipient: { id },
    message: { text },
  });
  const qs = 'access_token=' + encodeURIComponent(process.env.PAGE_ACCESS_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

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

function sendGenericMessage(recipientId, payload) {
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
			recipient: {id:recipientId},
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

function read_message(recipientId, user_message) {
// Sends a message to the user(id) based on message
/// read_message(str,str) -> None
  var msg = user_message.toLowerCase();
  switch(msg) {
    case "check in" :
      sendMessage(recipientId, {text: "Please send your location"});
      break;

    case "what is my name" :
      sendMessage(recipientId, {text: "Your name is " + user.first_name});
      break;

    case "create inspection" :
      if (isAgent(recipientId)) {
        // Update agent status to creating inspection
        message = {_id:recipientId, creating_inspection: true};

        db.collection(AGENTS).insert(message, function(err, result) {
          if (err) {
            console.log("Error updating agent. Error:", err);
          } else {
            console.log("Updated agent");
          };
        });
        sendMessage(recipientId, {text:"Send your location to create an inspection"});
      };
      break;

    default :
      sendMessage(recipientId, {text: "Sorry I don't understand what you mean by " + msg });
      break;

    // Add another statement to catch address
  };
};

// Initialize the app
app.listen((process.env.PORT || 3000));
console.log("Listening on Port 3000");
