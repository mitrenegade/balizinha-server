//const axios = require('axios');
//const functions = require('firebase-functions');
//const admin = require('firebase-admin');

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
            return exports.subscribeToTopic(token, topic)
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
        var topic = "eventOrganizer" + eventId
        if (token && token.length > 0) {
        	console.log("CreateOrganizerTopicForNewEvent v1.0: " + eventId + " subscribing " + organizerId + " to " + topic)
            return exports.subscribeToTopic(token, topic)
        } else {
            return console.log("CreateOrganizerTopicForNewEvent v1.0: " + eventId + " user " + organizerId + " did not have fcm token")
        }
    })
}

// Push
exports.sendPushToTopic = function(title, topic, msg, admin) {
    var topicString = "/topics/" + topic
    // topicString = topicString.replace(/-/g , '_');
    console.log("Push v1.0: send push to topic " + topicString + " message: " + msg)
    var payload = {
        notification: {
            title: title,
            body: msg,
            sound: 'default',
            badge: '1'
        }
    };
    return admin.messaging().sendToTopic(topicString, payload);
}

exports.subscribeToTopic = function(token, topic, admin) {
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

exports.unsubscribeFromTopic = function(token, topic, admin) {
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

exports.pushForCreateEvent = function(eventId, name, place, exports, admin) {
    var title = "New event available"
    var topic = "general"
    var msg = "A new event, " + name + ", is available in " + place
    console.log("Push v1.0 for CreateEvent: sending push " + title + " to " + topic + " with msg " + msg)
    return exports.sendPushToTopic(title, topic, msg) // TODO: this gets called twice
}

exports.pushForJoinEvent = function(eventId, name, join, exports, admin) {
	var joinedString = "joined"
	if (!join) {
		joinedString = "left"
	}
    var msg = name + " has " + joinedString + " your game"
    var title = "Event update"
    var organizerTopic = "eventOrganizer" + eventId // join/leave message only for owners
    console.log("Push v1.0 for JoinEvent: user " + name + " joined event " + organizerTopic + " with message: " + msg)
    return exports.sendPushToTopic(title, organizerTopic, msg)
}

// leagues
topicForLeague = function(leagueId) {
    if (league == undefined) {
        throw new Error("League id must be specified for topic")
    }
    return "league" + leagueId
}

exports.doSubscribeToLeagueTopic = function(leagueId, userId, isSubscribe, exports, admin) {
    // subscribe a player to a topic for a league
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        var topic = topicForLeague(leagueId)
        if (token == undefined || token.length == 0) {
            let message = "Subscribe to league topic: no token available"
            return console.log(message)
        } else if (isSubscribe) {
            console.log("Subscribe to League topic: " + topic + " token: " + token)
            return exports.subscribeToTopic(token, topic)
        } else {
            console.log("Unsubscribe to League topic: " + topic + " token: " + token)
            return exports.unsubscribeToTopic(token, topic)
        }
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

