//const axios = require('axios');
//const functions = require('firebase-functions');
const admin = require('firebase-admin');

topicForLeague = function(leagueId) {
    if (leagueId == undefined) {
        throw new Error("League id must be specified for topic")
    }
    return "league" + leagueId
}

topicForEvent = function(eventId) {
    if (eventId == undefined) {
        throw new Error("Event id must be specified for topic")
    }
    return "event" + eventId
}

topicForEventOrganizer = function(eventId) {
    if (eventId == undefined) {
        throw new Error("Event id must be specified for topic")
    }
    return "eventOrganizer" + eventId
}

// Send Push
exports.sendPushToTopic = function(title, topic, body, admin) {
    var topicString = "/topics/" + topic
    // topicString = topicString.replace(/-/g , '_');
    console.log("Push v1.0: send push to topic " + topicString + " title: " + title + " body: " + body)
    var payload = {
        notification: {
            title: title,
            body: body,
            sound: 'default',
            badge: '1'
        }
    };
    return admin.messaging().sendToTopic(topicString, payload);
}

// Subscription
subscribeToTopic = function(token, topic) {
    admin.messaging().subscribeToTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Push v1.0: Successfully subscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"]);
        })
        .catch(function(error) {
            console.log("Push v1.0: Error subscribing to topic:", error);
        }
    );
}

unsubscribeFromTopic = function(token, topic) {
    admin.messaging().unsubscribeFromTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Push v1.0: Successfully unsubscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"]);
        })
        .catch(function(error) {
            console.log("Push v1.0: Error unsubscribing from topic:", error);
        }
    );
}

exports.refreshSubscriptions = function(req, res, exports, admin) {
    let userId = req.body.userId

    // user should be subscribed to leagues and events
    // also event organizers
    var topics = []
    return admin.database().ref(`playerLeagues/${userId}`).once('value').then(snapshot => {
        snapshot.forEach(child => {
            if (child.val().exists) {
                let leagueId = child.key
                let status = child.val()
                if (status == "member" || status == "organizer") {
                    let leagueTopic = topicForLeague(leagueId)
                    topics.append(leagueTopic)
                }
            }
        })
        return admin.database().ref(`userEvents/${userId}`).once('value').then(snapshot => {
            snapshot.forEach(child => {
                if (child.val().exists) {
                    let eventId = child.key
                    let active = child.val()
                    if (active == true) {
                        let eventTopic = topicForEvent(eventId)
                        topics.append(eventTopic)
                    }
                }
            })

            return console.log("RefreshSubscriptions: user " + userId + " topics " + JSON.stringify(topics))
        })
    })
}

// Organizers
// https://aaronczichon.de/2017/03/13/firebase-cloud-functions/
exports.subscribeToOrganizerPush = function(snapshot, context, exports, admin) {
    var organizerId = context.params.organizerId
    var val = snapshot.after.val()

    return admin.database().ref(`/players/${organizerId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        var topic = "organizers"
        if (token && token.length > 0) {
            console.log("organizer: created " + organizerId + " subscribed to organizers")
            return subscribeToTopic(token, topic)
        } else {
            console.log("subscribeToOrganizerPush: logged in with id: " + organizerId + " but no token available")
        }
    })
}

exports.createOrganizerTopicForNewEvent = function(eventId, organizerId, exports, admin) {
    // subscribe organizer to event topic - messages about users joining and leaving
    return admin.database().ref(`/players/${organizerId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        var topic = topicForEventOrganizer(eventId)
        if (token && token.length > 0) {
            console.log("CreateOrganizerTopicForNewEvent v1.0: " + eventId + " subscribing " + organizerId + " to " + topic)
            return subscribeToTopic(token, topic)
        } else {
            return console.log("CreateOrganizerTopicForNewEvent v1.0: " + eventId + " user " + organizerId + " did not have fcm token")
        }
    })
}

// Events
exports.subscribeToEvent = function(eventId, userId, join, exports, admin) {
    console.log("SubscribeToEvent: " + eventId + " user: " + userId + " joining: " + join)
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        let player = snapshot.val()
        var token = player["fcmToken"]
        var eventTopic = topicForEvent(eventId)
        if (token == undefined || token.length == 0) {
            let message = "Subscribe to event topic: no token available"
            return console.log(message)
        } else if (join) {
            console.log("Subscribe to event topic: " + topic + " token: " + token)
            return subscribeToTopic(token, topic)
        } else {
            console.log("Unsubscribe to event topic: " + topic + " token: " + token)
            return unsubscribeFromTopic(token, topic)
        }
    })
}

exports.pushForCreateEvent = function(eventId, leagueId, name, place, exports, admin) {
    var title = "New event available"
    let topic = topicForLeague(leagueId)
    var msg = "A new event, " + name + ", is available in " + place
    console.log("Push v1.0 for CreateEvent: sending push " + title + " to " + topic + " with msg " + msg)
    return exports.sendPushToTopic(title, topic, msg)
}

exports.pushForJoinEvent = function(eventId, name, join, exports, admin) {
	var joinedString = "joined"
	if (!join) {
		joinedString = "left"
	}
    var msg = name + " has " + joinedString + " your game"
    var title = "Event update"
    var topic = topicForEventOrganizer(eventId) // join/leave message only for owners
    console.log("Push v1.0 for JoinEvent: user " + name + " joined event " + organizerTopic + " with message: " + msg)
    return exports.sendPushToTopic(title, topic, msg)
}

// leagues
exports.subscribeToLeague = function(leagueId, userId, isSubscribe, exports, admin) {
    // subscribe a player to a topic for a league
    console.log("SubscribeToLeague: " + leagueId + " user: " + userId + " isSubscribe: " + isSubscribe)
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        let player = snapshot.val()
        var token = player["fcmToken"]
        var topic = topicForLeague(leagueId)
        if (token == undefined || token.length == 0) {
            let message = "Subscribe to league topic: no token available"
            return console.log(message)
        } else if (isSubscribe) {
            console.log("Subscribe to League topic: " + topic + " token: " + token)
            return subscribeToTopic(token, topic)
        } else {
            console.log("Unsubscribe to League topic: " + topic + " token: " + token)
            return unsubscribeFromTopic(token, topic)
        }
    })
}

exports.pushForLeagueFeedItem = function(leagueId, type, userId, message, exports, admin) {
    return admin.database().ref(`/leagues/${leagueId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("League doesn't exist for push")
        }
        let league = snapshot.val()
        var title = "New league message received" // should probably not happen
        if (league.name != undefined) {
            title = "New message in " + league.name
        }
        let topic = topicForLeague(leagueId)
        var body = ""
        var actionString = ""
        if (type == "chat") {
            actionString = " said: " + message
        } else if (type == "photo") {
            var name = league.name
            if (league.name == undefined) {
                name = "the league"
            }
            actionString = " sent a new photo to " + league.name
        } else { // if an unknown action
            throw new Error("Unknown feed item type")
        }
        return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
            if (!snapshot.exists() || snapshot.val().name == undefined) {
                body = "Someone" + actionString
            } else {
                body = snapshot.val().name + actionString
            }
            console.log("Push v1.0 for LeagueFeedItem: sending push " + title + " to " + topic + " with body " + body)
            return exports.sendPushToTopic(title, topic, body)
        })
    }).catch(function(error) {
        // catches this error so that the push doesn't cause the action to fail
        return console.log("Push v1.0: Error sending push for feed item: ", error.message);
    })
}

// test send push with explicit token
exports.sendPush = function(token, msg, admin) {
    //var testToken = "duvn2V1qsbk:APA91bEEy7DylD9iZctBtaKz5nS9CVZxpaAdaPwhIauzQ2jw81BF-oE0nhgvN3U10mqClTue0siwDH41JZP2kLqU0CkThOoBBdFQYWOr8X_6qHIknBE-Oa195qOy8XSbJvXeQj4wQa9T"
    
    var tokens = [token]
    var payload = {
        notification: {
            title: 'Firebase Notification',
            body: msg,
            sound: 'default',
            badge: "2"
        }
    };
    return admin.messaging().sendToDevice(tokens, payload);
}

