//const axios = require('axios');
//const functions = require('firebase-functions');
//const admin = require('firebase-admin');

// https://aaronczichon.de/2017/03/13/firebase-cloud-functions/
exports.subscribeToOrganizerPushV1_5 = function(snapshot, context, exports, admin) {
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

exports.createOrganizerTopicForNewEventV1_5 = function(eventId, organizerId, exports, admin) {
    // subscribe organizer to event topic - messages about users joining and leaving
    return admin.database().ref(`/players/${organizerId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        var topic = "eventOrganizer" + eventId
        if (token && token.length > 0) {
        	console.log("CreateOrganizerTopicForNewEvent v1.5: " + eventId + " subscribing " + organizerId + " to " + topic)
            return exports.subscribeToTopic(token, topic)
        } else {
            return console.log("CreateOrganizerTopicForNewEvent v1.5: " + eventId + " user " + organizerId + " did not have fcm token")
        }
    })
}

// Push
exports.sendPushToTopicV1_5 = function(title, topic, msg, admin) {
    var topicString = "/topics/" + topic
    // topicString = topicString.replace(/-/g , '_');
    console.log("send push to topic " + topicString)
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

exports.sendPushV1_5 = function(token, msg, admin) {
    //var testToken = "duvn2V1qsbk:APA91bEEy7DylD9iZctBtaKz5nS9CVZxpaAdaPwhIauzQ2jw81BF-oE0nhgvN3U10mqClTue0siwDH41JZP2kLqU0CkThOoBBdFQYWOr8X_6qHIknBE-Oa195qOy8XSbJvXeQj4wQa9T"
    
    var tokens = [token]
    console.log("send push to token " + token)
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

exports.subscribeToTopicV1_5 = function(token, topic, admin) {
    admin.messaging().subscribeToTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Successfully subscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"]);
        })
        .catch(function(error) {
            console.log("Error subscribing to topic:", error);
        }
    );
}

exports.unsubscribeFromTopicV1_5 = function(token, topic, admin) {
    admin.messaging().unsubscribeFromTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Successfully unsubscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"]);
        })
        .catch(function(error) {
            console.log("Error unsubscribing from topic:", error);
        }
    );
}

exports.pushForCreateEventV1_5 = function(eventId, exports, admin) {
    console.log("CreateEvent v1.5 sending push")
    var title = "New event available"
    var topic = "general"
    var placeName = city
    if (city == undefined) {
        placeName = place
    }
    var msg = "A new event, " + name + ", is available in " + placeName
    console.log("CreateEvent v1.4: sending push " + title + " to " + topic + " with msg " + msg)
    return exports.sendPushToTopic(title, topic, msg) // TODO: this gets called twice
}

exports.pushForJoinEventV1_5 = function(name, eventId, join, exports, admin) {
	var joinedString = "joined"
	if (!join) {
		joinedString = "left"
	}
    var msg = name + " has " + joinedString + " your game"
    var title = "Event update"
    var organizerTopic = "eventOrganizer" + eventId // join/leave message only for owners
    console.log("Sending push for user " + name + " joined event " + organizerTopic + " with message: " + msg)
    return exports.sendPushToTopic(title, organizerTopic, msg)
}
