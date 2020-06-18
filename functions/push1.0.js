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
// deprecated
exports.sendPushToTopic = function(title, topic, body) {
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
    return admin.messaging().subscribeToTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            return response
        })
        .catch(function(error) {
            return console.error("Push v1.0: subscribeToTopic: Error subscribing to topic: " + topit + " error: " + JSON.stringify(error))
        }
    );
}

unsubscribeFromTopic = function(token, topic) {
    return admin.messaging().unsubscribeFromTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Push v1.0: unsubscribeToTopic: Successfully unsubscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"])
        })
        .catch(function(error) {
            console.error("Push v1.0: unsubscribeToTopic: Error unsubscribing from topic: " + topic + " error: " + JSON.stringify(error))
        }
    );
}

// subscription list on player
doUpdateSubscriptionStatus = function(userId, topic, enabled) {
    var params = {[topic]: enabled}
    return admin.database().ref(`playerTopics/${userId}`).update(params)
}

// Organizers
// https://aaronczichon.de/2017/03/13/firebase-cloud-functions/
exports.subscribeToOrganizerPush = function(snapshot, context, exports, admin) {
    var organizerId = context.params.organizerId
    var val = snapshot.after.val()
    let topic = "organizers"

    return admin.database().ref(`/players/${organizerId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        if (token && token.length > 0) {
            console.log("Push 1.0: subscribeToOrganizerPush: userId: " + organizerId + " subscribed to " + topic)
            return subscribeToTopic(token, topic)
        } else {
            console.error("Push 1.0: subscribeToOrganizerPush: logged in with id: " + organizerId + " but no token available")
        }
    }).then(result => {
        return doUpdateSubscriptionStatus(organizerId, topic, true)
    })
}

exports.createOrganizerTopicForNewEvent = function(eventId, organizerId, exports, admin) {
    // subscribe organizer to event topic - messages about users joining and leaving
    let topic = topicForEventOrganizer(eventId)
    return admin.database().ref(`/players/${organizerId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        if (token && token.length > 0) {
            console.log("Push 1.0: createOrganizerTopicForNewEvent: " + eventId + " subscribing " + organizerId + " to " + topic)
            return subscribeToTopic(token, topic)
        } else {
            return console.log("CreateOrganizerTopicForNewEvent v1.0: " + eventId + " user " + organizerId + " did not have fcm token")
        }
    }).then(result => {
        return doUpdateSubscriptionStatus(organizerId, topic, true)
    })
}

// Events
exports.subscribeToEvent = function(eventId, userId, join, exports, admin) {
    let topic = topicForEvent(eventId)
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        let player = snapshot.val()
        var token = player["fcmToken"]
        console.log("Push 1.0: subscribeToEvent: userId: " + userId + " topic " + topic + " join " + join)
        if (token == undefined || token.length == 0) {
            let message = "Subscribe to event topic: no token available"
            console.error("Push 1.0: subscribeToEvent: userId: " + userId + " no token available")
            return console.log(message)
        } else if (join) {
            return subscribeToTopic(token, topic).then(result => {
                return doUpdateSubscriptionStatus(userId, topic, join)
            })
        } else {
            return unsubscribeFromTopic(token, topic).then(result => {
                return doUpdateSubscriptionStatus(userId, topic, join)
            })
        }
    })
}

exports.pushForCreateEvent = function(eventId, leagueId, name, place, exports, admin) {
    var title = "New event available"
    let topic = topicForLeague(leagueId)
    var msg = "A new event, " + name + ", is available"
    if (place != undefined) {
        msg = msg + " in " + place
    }
    console.log("Push v1.0 for CreateEvent: sending push " + title + " to " + topic + " with msg " + msg)
    let info = {"type": "createEvent", "eventId": eventId}
    return exports.sendPushToTopic(title, topic, msg, info)
}

exports.pushForJoinEvent = function(eventId, name, join, exports, admin) {
	var joinedString = "joined"
	if (!join) {
		joinedString = "left"
	}
    var msg = name + " has " + joinedString + " your game"
    var title = "Event update"
    var topic = topicForEventOrganizer(eventId) // join/leave message only for owners
    console.log("Push v1.0 for JoinEvent: user " + name + " joined event " + topic + " with message: " + msg)
    let info = {"type": "joinEvent", "eventId": eventId}
    return exports.sendPushToTopic(title, topic, msg, info)
}

// leagues
exports.subscribeToLeague = function(leagueId, userId, isSubscribe, exports, admin) {
    // subscribe a player to a topic for a league
    console.log("SubscribeToLeague: " + leagueId + " user: " + userId + " isSubscribe: " + isSubscribe)
    let topic = topicForLeague(leagueId)
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            console.log("SubscribeToLeague: no player found")
            throw new Error("Invalid player")
        }
        let player = snapshot.val()
        var token = player["fcmToken"]
        console.log("Push 1.0: subscribeToLeague: userId: " + userId + " topic " + topic)
        if (token == undefined || token.length == 0) {
            console.error("Push 1.0: subscribeToLeague: userId: " + userId + " no token available")
            return // do nothing
        } else if (isSubscribe) {
            return subscribeToTopic(token, topic).then(result => {
                return doUpdateSubscriptionStatus(userId, topic, isSubscribe)
            })
        } else {
            return unsubscribeFromTopic(token, topic).then(result => {
                return doUpdateSubscriptionStatus(userId, topic, isSubscribe)
            })
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
            let info = {"type": "leagueChat", "leagueId": leagueId}
            return exports.sendPushToTopic(title, topic, body, info)
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

// admin function, but needs some private functions here
// Adds topics for a single user by adding all leagues and events to /playerTopics
doRefreshPlayerTopics = function(userId) {
    var topics = {}
    return admin.database().ref(`playerLeagues/${userId}`).once('value').then(snapshot => {
        snapshot.forEach(child => {
            if (child.exists()) {
                let leagueId = child.key
                let status = child.val()
                let leagueTopic = topicForLeague(leagueId)
                if (status == "member" || status == "organizer") {
                    topics[leagueTopic] = true
                } else {
                    topics[leagueTopic] = false
                }
            }
        })

        console.log("refreshAllPlayerTopics: leagues done with snapshot " + JSON.stringify(snapshot))    
        return admin.database().ref(`userEvents/${userId}`).once('value').then(snapshot => {
            snapshot.forEach(child => {
                if (child.exists()) {
                    let eventId = child.key
                    let active = child.val()
                    let eventTopic = topicForEvent(eventId)
                    topics[eventTopic] = active
                }
            })
            return console.log("refreshAllPlayerTopics: events done with snapshot " + JSON.stringify(snapshot))    
        })
    }).then(() => {
        console.log("refreshAllPlayerTopics: user " + userId + " topics " + JSON.stringify(topics))
        return admin.database().ref(`playerTopics/${userId}`).update(topics)
    })
}

exports.refreshAllPlayerTopics = function(req, res, exports, admin) {
    let userId = req.body.userId

    console.log("refreshAllPlayerTopics: user " + userId)
    // user should be subscribed to leagues and events
    return doRefreshPlayerTopics(userId).then(() => {
        res.status(200).json({"success": true})
    }).catch(err => {
        console.log("refreshAllPlayerTopics error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}

exports.refreshPlayerSubscriptions = function(req, res, exports, admin) {
    let userId = req.body.userId
    var pushEnabled = req.body.pushEnabled
    if (pushEnabled == undefined) {
        pushEnabled = true
    }
    console.log("Push 1.0: refreshPlayerSubscriptions userId " + userId + " pushEnabled " + pushEnabled)

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            return res.status(500).json({"error": "Invalid player"})
        }
        let player = snapshot.val()
        let token = player.fcmToken
        return doRefreshPlayerSubscriptions(userId, token, pushEnabled)
    }).then(result => {
        const subscribed = result.subscribed
        const unsubscribed = result.unsubscribed
        console.log("Push 1.0: RefreshPlayerSubscriptions: subscribed " + subscribed + " unsubscribed " + unsubscribed)
        return res.status(200).json({"success": true, "subscribed": subscribed, "unsubscribed": unsubscribed})        
    }).catch(err => {
        console.log("Push 1.0: RefreshPlayerSubscriptions error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}

exports.refreshPlayerSubscriptionsHelper = function(userId, token, pushEnabled) {
    return doRefreshPlayerSubscriptions(userId, token, pushEnabled)
}

doRefreshPlayerSubscriptions = function(userId, token, pushEnabled) {
    var topics = {}
    if (userId == undefined) {
        throw new Error("User id was not specified")
        return
    }
    if (token == undefined) {
        console.log("DoRefreshPlayerSubscriptions: player " + userId + " does not have a token")
        throw new Error("No token found, cannot subscribe or unsubscribe")
        return
    }

    console.log("DoRefreshPlayerSubscriptions: user " + userId + " pushEnabled " + pushEnabled + " for token " + token)
    // if token doesn't exist, then automatically becomes unsubscribe
    return admin.database().ref(`playerTopics/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            console.log("DoRefreshPlayerSubscriptions: no topics found for userId " + userId)
            return doRefreshPlayerTopics(userId).then(() => {
                return doRefreshPlayerSubscriptions(userId, token, pushEnabled)
            })
        } else {
            console.log("DoRefreshPlayerSubscriptions: player has " + snapshot.numChildren() + " topics. snapshot: " + JSON.stringify(snapshot))
            var subscribed = 0
            var unsubscribed = 0
            var promises = []
            snapshot.forEach(child => {
                let topic = child.key
                let active = child.val()
                if (active) {
                    if (pushEnabled == true) {
                        // active means the user is part of the league or event
                        var promiseRef = subscribeToTopic(token, topic)
                        promises.push(promiseRef)                            
                        subscribed = subscribed + 1
                    } else {
                        var promiseRef = unsubscribeFromTopic(token, topic)                           
                        promises.push(promiseRef)                            
                        unsubscribed = unsubscribed + 1
                    }
                } // else no need to enable/disable it
            })

            return Promise.all(promises).then(() => {
                return {"subscribed": subscribed, "unsubscribed": unsubscribed}
            })
        }
    })
}

