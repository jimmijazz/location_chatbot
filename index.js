// TO DO:
// Make Facebook graph call an async callback
// Create house locations
// Use fbMessage over SendMessage
// Show how a person could query about a house
// Condense new user check into a class (is agent? is new user? messages)
// Get home valuations


const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const fetch = require('node-fetch');
const app = express();
const geocoder = require('geocoder');
const mongodb = require("mongodb");
const ObjectID = mongodb.ObjectID;



// LockedOn CRM
var lockedOnCode = "6975de34da026024dae43389185661ef@lockedoncloud.com";

// Agent's Facebook page ID
const agentFBID = "652607908238304";

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

// Bot actions for Wit.Ai
const actions = {
  send({sessionId}, text) {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // We found our recipient. Let's forward our bot response to them.
      // We return a promise to let our bot know when we're done sending

      // Check if text paylad is an object
      if (text.text[0] === "{") {
        console.log("Sending generic message:" + text);
        sendGenericMessage(recipientId, text.text);
      } else {
        console.log("Sending regular message" + text);
        sendMessage(recipientId,text);
      }
      // return fbMessage(recipientId, text)
      // .then(() => null)
      // .catch((err) =>{
      //   console.error(
      //     'An error occurred while forwarding the response to',
      //     recipientId,
      //     ':',
      //     err.stack || err
      //   );
      // });
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
      console.log("Creating inspection");
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
                // Send response back to wit.ai
                  if(err) {
                    console.log(err);
                    inspection_message = "Error creating inspection at " + address;
                  } else {
                    inspection_message = "Created inspection at "+ address +
                                          " at " + hours + ":" + minutes + suffix;
                  }
                  context.inspection = inspection_message;

              });
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
      console.log("Creating property");

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
                "loc" : {
                  "type" : "Point",
                  "coordinates" : [data.results[0].geometry.location.lng, data.results[0].geometry.location.lat]
                }
              }, function(err, result) {
                if(err) {
                  console.log(err);
                  property_msg = "Property already exists at " + address;
                  context.property = property_msg;

                } else {
                  property_msg = "Created property at " + address + ".";
                  context.property = property_msg;

                }
              });
          }
        });
        delete context.address;
      } else if (!address) {
        context.address = true;
        delete context.address;
      }
      return resolve(context);
    });
  },

  // Sends a generic template message for the user to check into that property
  checkIn({context, entities}) {
    console.log("Checking In");
    return new Promise(function(resolve, reject) {
    //  const recipientId = sessions[sessionId].fbid;

      for(var prop in context){
        console.log(prop);
      };

      // Text version of address ie: 12 Mascot Street, Upper Mount Gravatt
      var address = firstEntityValue(entities, "location");

      if (address) {
        // Geocode text address into a google maps component
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
                      } else {
                          // For some reason it sends payload as a str so have to try and convert to JSON or split
                          var payload =
                          ("{" + '"title"' + ":" + '"' + address.formatted_address +'"' + ","+
                            '"subtitle"' + ":" + '"' + prop_result.description + '"' + ","+
                            '"image_url"' + ":" + '"' + prop_result.photos[0] + '"' + ","+
                            '"buttons"' + ":" + "[{" +
                              '"type"' + ":" + '"postback",' +
                               '"title"' + ":" + '"Check In",' +
                                '"payload"' + ":" + '"hello hello hello"'+
                              "},{" +
                                '"type"' + ":" + '"postback",' +
                                '"title"' + ":" + '"View Photos",' +
                                '"payload"' + ":" + '"hello hello hello"'+
                              "},{" +
                                '"type"' + ":" + '"postback",' +
                                '"title"' + ":" + '"Inspection Times",' +
                                '"payload"' + ":" + '"hello hello hello"'+
                                "}" +
                             "]" +
                            "}"
                          );

                        };
                        context.property = payload;
                  })

                }
              })
            }
          });
          //
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

      // Ignore messages from OpenHood page
      if (id != agentFBID) {
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
          console.log(event);

          // ** GET STARTED **//
          if (event.postback && event.postback.payload && event.postback.payload == "Get Started") {

                var msg_meta = {
                                    "message" : event.postback.payload,
                                    "timestamp" : event.timestamp,
                                    "mid" : "NA",
                                    "seq" : "NA"
                                };


                updateMsg(id,msg_meta);   // See if new user and update message.
                sendMessage(id, {text: "Hi " + user.first_name +". Thanks for looking at 146/54 Slobodian Avenue. You can ask us any question about the property or send 'help' for FAQ."} )

                // Might not work because sendGenericMessage != null so is true
                // if (sendGenericMessage(id, get_started) {
                //   sendQuickReply(id, "Are you renting or buying?", rentOrBuy);
                // })

                // if works delete the True/false from sendGenericMessage()
                sendGenericMessageThanQuickReply(id, get_started, "Are you renting or buying?", rentOrBuy);
                // sendGenericMessage(id,get_started);
                // sendQuickReply(id,"Are you renting or buying?", rentOrBuy );

          }

          // ** EMAIL VIA MESSAGE ** //
          else if (event.message && event.message.text && !event.message.echo && String(event.message.text).includes("@")) {
              // user sends email address
              var msg_meta = {
                                  "message" : event.message.text,
                                  "timestamp" : event.timestamp,
                                  "mid" : event.message.mid,
                                  "seq" : event.message.seq
                              };
              // See if new user and update messages
              updateMsg(id, msg_meta);
              sendMessage(id, {text: "Thank you."})
              // Update leads in LockedOn
              // Eventually this will have within the context of talking about a
              // property where the user asks about a property, we ask for their
              // email for updates and then update the database with leads.

              var formdata = {
                to: 				      lockedOnCode,
                property_address: "12 Mascot Street Upper Mount Gravatt",
                property_url: 		"",
                ad_id: 				    "",
                full_name: 			  user.first_name + " " + user.last_name,
                email: 				    event.message.text,
                phone: 				    "",
                comments: 			  ""
              };

              // Send enquiry to the server
              request({
                url: 'https://www.lockedoncloud.com/leads/submit',
                method:'POST',
                json: formdata,
              }, function(error, message, body) {
                  if (error) {
                    console.log("Error sending message: ", error);
                  } else if (response.body.error) {
                      console.log("Error: ", response.body.error);
                  } else {
                    console.log("Added lead")
                  }
                }
              );
            // HELP MESSAGES
          } else if (event.message && event.message.text && !event.message.echo && String(event.message.text).toLowerCase() == "help") {
            // TO DO: Replace agency details
            sendQuickReply(id,
              "This chat is managed by a bot to help you get instant answers to your questions. You can also email us at agent@bestagency.com. Here are some FAQ:",
            quickReply([
              {title:"Schools",payload:"schools"},
              {title:"Shops",payload:"shops"},
              {title:"NBN",payload:"nbn"},
              {title:"Features",payload:"features"},

            ])
          )
          // ** QUICK REPLIES ** //
          } else if ( event.message && event.message.quick_reply) {
              console.log("Quick Reply!");

              var reply = event.message.quick_reply.payload;

              switch(reply) {
                // Renting or buying
                case "renting":
                  sendQuickReply(id, "Great! Would you like to look at two or three bedroom apartments?", quickReply([
                    {title:"two",payload:"two"},
                    {title:"three",payload:"three"},
                  ]));
                  sendMessage(id, {text: "Thanks! You can ask us about nearby shops, schools or any other questions about the property."})
                  break;
                case "buying":
                  sendQuickReply(id, "Are you looking for an investment property?", quickReply([
                    {title:"Yes",payload:"investor"},
                    {title:"No",payload:"home owner"},
                  ]));
                  break;
                // Investor or home owner
                case "investor":
                  sendMessage(id, {text: "You can ask us about nearby shops, schools or any other questions about the property."})
                  break;
                case "home owner":
                  sendMessage(id,{text:"Thanks. This home is perfect for the first home buyers grant. You can ask us about nearby shops, schools or any other questions about the property."});

                // How many bedrooms
                case "two":
                  // send photos of two bedroom homes
                  sendGenericMessage(id, twoBedroom);
                  break;

                case "three":
                  // send photos of three bedroom homes
                  sendGenericMessage(id, threeBedroom);

                case "email_floorplans":

                  break;

                // Help Menu Options
                case "schools":
                  sendQuickReply(id, "Primary schools - Warrigal Road State School, Eight Mile Plains State School, Redeemer Lutheran College, MacGregor State School, St Peter's Primary School Secondary Schools - Rochedale State High School, Redeemer Lutheran College, MacGregor State High School, Runcorn State High SChool, Brisbane Adventist College",
                    quickReply([
                      {title:"Schools",payload:"schools"},
                      {title:"Shops",payload:"shops"},
                      {title:"NBN",payload:"nbn"},
                      {title:"Features",payload:"features"},

                    ])
                  );
                  break;
                case "shops":
                  sendQuickReply(id, "Garden city is five minutes away",
                    quickReply([
                      {title:"Schools",payload:"schools"},
                      {title:"Shops",payload:"shops"},
                      {title:"NBN",payload:"nbn"},
                      {title:"Features",payload:"features"},

                    ])
                  )
                break;
                case "nbn":
                  sendQuickReply(id, "All homes are NBN ready!",
                    quickReply([
                      {title:"Schools",payload:"schools"},
                      {title:"Shops",payload:"shops"},
                      {title:"NBN",payload:"nbn"},
                      {title:"Features",payload:"features"},

                    ])
                  )
                break;
                case "features" :
                  sendQuickReply(id, "Each apartment",
                    quickReply([
                      {title:"Schools",payload:"schools"},
                      {title:"Shops",payload:"shops"},
                      {title:"NBN",payload:"nbn"},
                      {title:"Features",payload:"features"},

                    ])
                );
                break;
                default :
                  console.log("didnt understand quick reply");
                  break;
              }
            }

          // ** TEXT MESSAGE (Default if text doesn't meet above criteria)** //
          else if (event.message && event.message.text && !event.message.echo) {
              console.log("Text Message");
              var msg_meta = {
                                  "message" : event.message.text,
                                  "timestamp" : event.timestamp,
                                  "mid" : event.message.mid,
                                  "seq" : event.message.seq
                              };

              // See if a new user
              updateMsg(id, msg_meta);

              if(isAgent(id)) {
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
                  console.log(sessionId,event.message.text,sessions[sessionId].context);
                  console.error('Got an error from Wit: ', err.stack || err);

                })
              } else {
                // User is not agent. Currently only  using one bot. Eventually
                // might use two (one for agent one for users).
                wit_agent.runActions(
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

            // ** LOCATION MESSAGE ** //
          } else if (event.message && event.message.attachments && event.message.attachments[0].type == 'location') {

                // Get lat and longitude from location object
                var lat = event.message.attachments[0].payload.coordinates.lat;
                var long = event.message.attachments[0].payload.coordinates.long;

                // Send Generic Message with location
                geocoder.reverseGeocode(lat,long,function(err, data){
                  if(err) {
                    console.log("Error geocoding property location");
                  } else {
                    // data = google JSON formatted address
                    var address = data.results[0];

                    // Search for property in $maxDistance amount of metres
                    db.collection(PROPERTIES).findOne(
                      {
                        loc : {
                        $near : {
                          $geometry: {
                            type : "Point" ,
                             coordinates: [long, lat]
                           },
                           $maxDistance : 5000 }
                         }
                   }, function(err, result){
                      if (err) {
                        console.log("Error finding property. Error: " + err);
                      } else if (result) {
                          console.log("Property found by location!" + result);
                          var location_image = map_url + lat + "," + long + "&zoom=" + 20 + "&size=640x400&key=" + google_api_key;
                          var payload =
                          ("{" + '"title"' + ":" + '"' + address.formatted_address +'"' + ","+
                            '"subtitle"' + ":" + '"' + result.description + '"' + ","+
                            '"image_url"' + ":" + '"' + result.photos[0] + '"' + ","+
                            '"buttons"' + ":" + "[{" +
                              '"type"' + ":" + '"postback",' +
                               '"title"' + ":" + '"Check In",' +
                                '"payload"' + ":" + '"hello hello hello"'+
                              "},{" +
                                '"type"' + ":" + '"postback",' +
                                '"title"' + ":" + '"View Photos",' +
                                '"payload"' + ":" + '"hello hello hello"'+
                              "},{" +
                                '"type"' + ":" + '"postback",' +
                                '"title"' + ":" + '"Inspection Times",' +
                                '"payload"' + ":" + '"hello hello hello"'+
                                "}" +
                             "]" +
                            "}"
                          );

                        sendGenericMessage(id, payload );
                        for (var key in result) {
                          console.log(result[key]);
                        }
                      } else {
                        console.log("No property found ")
                      }
                    });
                  }           // FIX CALLBACK MESS
                });

          }

          });
      };
    };

    res.sendStatus(200);
  });

// Generic function sending messages
const fbMessage = (id, text) => {
//  var x = true; // I think this was here to test the generic message
  console.log(text.text);
  payload = JSON.parse(text.text);
  console.log(payload);


  if (x) {
    var body = JSON.stringify({
      recipient: { id },
      "message": {
        "attachment": {
          "type" : "template",
          "payload" : {
            "template_type" : "generic",
            "elements" : [{
              "title": payload.title,
              "subtitle" : payload.subtitle,
              "image_url" : payload.image_url,
              "buttons" : payload.buttons,
            }],
          }
        }
      },
    });
  } else {
      var body = JSON.stringify({
        recipient: { id },
        message: { text },
      });
  }

  const qs = 'access_token=' + encodeURIComponent(process.env.PAGE_ACCESS_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message + json);
    }
    return json;
  });
};


function sendMessage(recipientId, message) {
  // Sends normal text message to recipient ID
  // sendMessage(string, {text:string})

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
        //console.log(body);
    });
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
  // Sends a generic message to the user. Returns true if successful
  // sendGenericMessage(string,array[object]) -> Bool
	var messageData = {
		"attachment": {
			"type": "template",
			"payload": {
				"template_type": "generic",
				"elements": payload
			}
		}
	};
  //console.log(messageData);

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
		} else {
      result = true;
    }
    return result;
	})
};

function sendQuickReply(recipientId,message,buttons){
  // Sends quick reply button(s) to the user
  // sendQuickReply(string, dict) -> None
  var messageData = {
      "text" : message,
      "quick_replies": buttons
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

function sendGenericMessageThanQuickReply(recipientId, payload, text, buttons) {
  // Sends a generic message to the user. If successful sends quick reply message.
  // sendGenericMessageThanQuickReply(string,array[object], string, array[object]) -> None

  let result = false;
	var messageData = {
		"attachment": {
			"type": "template",
			"payload": {
				"template_type": "generic",
				"elements": payload
			}
		}
	};

  var quickMessageData = {
      "text" : text,
      "quick_replies": buttons
  };


  // First send generic message
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
		} else {
      request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:process.env.PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
          recipient: {id:recipientId},
          message: quickMessageData,
        }
      }, function(error, response, body) {
        if (error) {
          console.log("Error sending messages: ", error)
        } else if (response.body.error) {
          console.log("Error: ", response.body.error)
        };
      })
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

function requestLocation(id) {

  var payload = {
  "text" : "Please share your location:",
  "quick_replies" : [
    {
      "content_type":"location",
    }
  ]
}

sendMessage(id, payload);
}

function updateMsg(id, msg) {
  // Updates the database with messages the user has sent.
  // updateMsg(string,string) -> None

  // TO DO: - Check if user is a registered agent

  // 1. Check if new user
  db.collection(PEOPLE).count({_id:id}, function(err, count){
    if(count === 0) {

      // 1a. If new user, insert into database
      db.collection(PEOPLE).insert({_id : id, messages:msg, function(err, result) {
        if (err) {
          console.log("Error updating PEOPLE. Error: ", err)
        } else {
          console.log("Updated PEOPLE");
        };
      }
      });
      // 1.b If not new user, update user messages
    } else {
        db.collection(PEOPLE).update({_id: id}, { $push: {messages: msg}}, function(err, result){
          if (err) {
            console.log("Error updating msg_meta. Error: ", err);
          } else {
            console.log("Updated msg_meta");
          };
        });
      }
  });
};

function isAgent(id) {
  // Checks if the user is a registered agent
  // isAgent(string) -> Bool

  db.collection(AGENTS).findOne({_id : id}, function (err, result) {
    if (err) {
      console.log("Error finding agent. Error: ", err);
      return false;
    } else if (result) {
      return true;
    } else {
      return false;
    }
  })
};

// Message Definitions (Hardcoded for MVP, will reference Db)

// Get Started Message
// const get_started =
//               "{" + '"title"' + ":" + '"' + "146/54 Slobodian Avenue" +'"' + ","+
//                   '"subtitle"' + ":" + '"' + "This striking residential building is part of an expanding new precinct that's impressively located and offers discerning buyers a fantastic opportunity in Eight Mile Plains."
//                    + '"' + ","+
//                   '"image_url"' + ":" + '"' + "http://cdn1.ljhooker.com/57874eaf7bd719e719000279.jpg" + '"' +
//                   "}"
//                 ;
const get_started = ([{
  "title" : "146/54 Slobodian Avenue",
  "subtitle" : " Striking residential building",
  "image_url" :  "http://cdn1.ljhooker.com/57874eaf7bd719e719000279.jpg"
},{
"title" : "Open Living Area",
"subtitle" : "146/54 Slobodian Avenue",
"image_url" :  "http://cdn1.ljhooker.com/57522bf67dd7196c3c00005a.jpg"
},{
"title" : "New Kitchen Appliances",
"subtitle" : "146/54 Slobodian Avenue",
"image_url" :  "http://cdn2.ljhooker.com/56d425fc7cd7193b270008f2.jpg"
}


// {
// "title" : "Modern Bathroom",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn2.ljhooker.com/56d425fc7cd7193b27000904.jpg"
// },{
// "title" : "Master Bedroom",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn3.ljhooker.com/56d425fc7cd7193b270008fe.jpg"
// },
// {
// "title" : "Guest Bedroom",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn3.ljhooker.com/56d425fc7cd7193b27000900.jpg"
// },{
// "title" : "Choose from 13 floor plans",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn3.ljhooker.com/57874eaf7bd719e719000282.jpg"
// },{
// "title" : "Carpet or Wood Floors",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn3.ljhooker.com/57874eaf7bd719e719000284.jpg"
// },{
// "title" : "Study with a View",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn4.ljhooker.com/57874eaf7bd719e719000288.jpg"
// },{
// "title" : "Fully Air Conditioned",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn4.ljhooker.com/57874eaf7bd719e71900028a.jpg"
// },{
// "title" : "Generous Balcony Views",
// "subtitle" : "146/54 Slobodian Avenue",
// "image_url" :  "http://cdn4.ljhooker.com/57874eaf7bd719e71900028a.jpg"
// }
]);

const twoBedroom = ([{
  "title" : "Two Bedroom Floorplan",
  "subtitle" : "146/54 Slobodian Avenue",
  "image_url" :  "http://cdn6.ljhooker.com/56d425fc7cd7193b2700090e.jpg"
},{
"title" : "Two bedrooms",
"subtitle" : "146/54 Slobodian Avenue",
"image_url" :  "http://cdn5.ljhooker.com/57874eaf7bd719e719000292.jpg"
},{
"title" : "New Kitchen Appliances",
"subtitle" : "146/54 Slobodian Avenue",
"image_url" :  "http://cdn6.ljhooker.com/57874eaf7bd719e719000298.jpg"
}
]);

const threeBedroom = ([{
  "title" : "146/54 Slobodian Avenue",
  "subtitle" : "146/54 Slobodian Avenue",
  "image_url" :  "http://cdn3.ljhooker.com/57874eaf7bd719e719000284.jpg"
},{
"title" : "Open Living Area",
"subtitle" : "146/54 Slobodian Avenue",
"image_url" :  "http://cdn3.ljhooker.com/57874eaf7bd719e719000282.jpg"
},{
"title" : "New Kitchen Appliances",
"subtitle" : "146/54 Slobodian Avenue",
"image_url" :  "http://cdn4.ljhooker.com/57874eaf7bd719e719000288.jpg"
}
]);


// condense this into one variable that can accept input for title & payload.
const rentOrBuy = ([
  {"content_type":"text",
    "title":"Renting",
    "payload":"renting"
  },
  {
    "content_type":"text",
    "title":"Buying",
    "payload":"buying"
  }
]);

const isInvestor = ([
  {"content_type":"text",
    "title":"Yes",
    "payload":"investor"
  },
  {
    "content_type":"text",
    "title":"No",
    "payload":"home owner"
  }
]);

const floorPlans = ([
  {"content_type":"text",
    "title":"Yes",
    "payload":"email_floorplans"
  },
  {
    "content_type":"text",
    "title":"No",
    "payload":"no_floorplans"
  }
]);

function quickReply(buttons) {
  // Used for generating quick reply template
  // quickReply([dict]) - > []
  replies = [];
  for (i = 0; i < buttons ; i ++ ) {

    var button =
    {
      "content_type":"text",
      "title":button[i].title,
      "payload":button[i].payload
    };

    replies.push(button);
  }
  return replies;
}

// Initialize the app
app.listen((process.env.PORT || 3000));
console.log("Listening on Port 3000");


// FIN//
