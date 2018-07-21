exports.createEventV1_4 = function(req, res, exports, admin) {
    const userId = req.body.userId
    if (userId == undefined) { res.status(500).json({"error": "A valid user is required to create event"}); return }

    var league = req.body.league
    var name = req.body.name
    var type = req.body.type
    if (league == undefined) { league = DEFAULT_LEAGUE }
    if (name == undefined) { name = "Balizinha" }
    if (type == undefined) { type = "3 vs 3" }

    const city = req.body.city
    const state = req.body.state
    const place = req.body.place
    const info = req.body.info

    if (city == undefined) { res.status(500).json({"error": "City is required to create event"}); return }
    if (place == undefined) { res.status(500).json({"error": "Location is required to create event"}); return }

    var maxPlayers = req.body.maxPlayers
    if (maxPlayers == undefined) { maxPlayers = 6 }

    const startTime = req.body.startTime
    const endTime = req.body.endTime
    if (startTime == undefined) { res.status(500).json({"error": "Start time is required to create event"}); return } // error if not exist
    if (endTime == undefined) { res.status(500).json({"error": "End time is required to create event"}); return }

    const paymentRequired = req.body.paymentRequired
    const amount = req.body.amount

    const lat = req.body.lat
    const lon = req.body.lon

    var params = {"league": league, "name": name, "type": type, "city": city, "place": place, "startTime": startTime, "endTime": endTime, "maxPlayers": maxPlayers}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    params["organizer"] = userId
    params["owner"] = userId // older apps used "owner" as the organizer

    // optional params
    if (paymentRequired) { params["paymentRequired"] = paymentRequired }
    if (amount) { params["amount"] = amount }
    if (state) { params["state"] = state }
    if (info) { params["info"] = info }
    if (lat) { params["lat"] = lat }
    if (lon) { params["lon"] = lon }

    var eventId = exports.createUniqueId()

    var ref = `/events/` + eventId
    return admin.database().ref(ref).set(params)
    .then(result => {
        // join event
        console.log("CreateEvent v1.4 success for event " + eventId + " with result " + JSON.stringify(result))
        return exports.doJoinOrLeaveEventV1_4(userId, eventId, true, admin)
    }).then(result => {
        // send push
        // TODO: make these promises as well
        console.log("CreateEvent v1.4 sending push")
        var title = "New event available"
        var topic = "general"
        var placeName = city
        if (city == undefined) {
            placeName = place
        }
        var msg = "A new event, " + name + ", is available in " + placeName
        console.log("CreateEvent v1.4: sending push " + title + " to " + topic + " with msg " + msg)
        exports.sendPushToTopic(title, topic, msg) // TODO: this gets called twice

        console.log("CreateEvent v1.4: createTopicForEvent")
        return exports.createTopicForNewEvent(eventId, userId)

    }).then(result => {
        // create action
        console.log("CreateEvent v1.4 createAction event " + eventId + " organizer " + userId)
        var type = "createEvent"
        return exports.createAction(type, userId, eventId, null)
    }).then(result => {
        return res.status(200).json({"result": result, "eventId": eventId})
    })
    // .catch(error => {
    //     console.log("CreateEvent v1.4 error: " + JSON.stringify(error));
    //     return res.status(500).json({"error": error})
    // })
}

// helper function
exports.doJoinOrLeaveEventV1_4 = function(userId, eventId, join, admin) {
    console.log("joinOrLeaveEvent v1.4: " + userId + " join? " + join + " " + eventId)
    var params = { [userId] : join }
    return admin.database().ref(`/eventUsers/${eventId}`).update(params).then(results => {
        var params2 = { [eventId] : join }
        return admin.database().ref(`userEvents/${userId}`).update(params2)
    })
}

// cloud function
exports.joinOrLeaveEventV1_5 = function(req, res, exports, admin) {
    var userId = req.body.userId
    var eventId = req.body.eventId
    var join = req.body.join

    console.log("joinOrLeaveEvent v1.5: " + userId + " join? " + join + " " + eventId)
    return exports.doJoinOrLeaveEventV1_4(userId, eventId, join, admin).then(result => {
        console.log("joinOrLeaveEvent v1.5: results " + JSON.stringiy(result))
        return res.status(200).json({"result": result, "eventId": eventId})
    })
}

// event creation/change
exports.onEventChangeV1_4 = function(snapshot, context, exports, admin) {
    var eventId = context.params.eventId
    var data = snapshot.after.val()
    var old = snapshot.before

    console.log("onEventChange v1.4: event " + eventId + " data " + JSON.stringify(data))

    if (!old.exists()) {
        console.log("event created: " + eventId + " state: " + JSON.stringify(data))
        return snapshot
    } else if (old["active"] == true && data["active"] == false) {
        return console.log("event deleted: " + eventId + " state: " + JSON.stringify(old))
        // deleted
        var title = "Event cancelled"
        var topic = "event" + eventId
        var name = data["name"]
        var city = data["city"]
        if (!city) {
            city = data["place"]
        }

        // send push
        var msg = "An event you're going to, " + name + ", has been cancelled."
        return exports.sendPushToTopic(title, topic, msg)
    } else {
        console.log("event change: " + eventId)
        return snapshot
    }
}

// join/leave event
exports.onUserJoinOrLeaveEventV1_4 = function(snapshot, context, exports, admin) {
    const eventId = context.params.eventId
    const userId = context.params.userId
    var data = snapshot.after.val()
    var old = snapshot.before

    var eventUserChanged = false;
    var eventUserCreated = false;

    if (!old.exists()) {
        eventUserCreated = true;
        console.log("onUserJoinOrLeaveEvent: created user " + userId + " for event " + eventId + ": " + JSON.stringify(data))
    }
    if (!eventUserCreated) {
        eventUserChanged = true;
        console.log("onUserJoinOrLeaveEvent: updated user " + userId + " for event " + eventId + ": " + JSON.stringify(data))
    }

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var name = player["name"]
        var email = player["email"]
        var joinedString = "joined"
        if (data == false) {
            joinedString = "left"
        }
        var msg = name + " has " + joinedString + " your game"
        var title = "Event update"
        var organizerTopic = "eventOrganizer" + eventId // join/leave message only for owners
        console.log("Sending push for user " + name + " " + email + " joined event " + organizerTopic + " with message: " + msg)

        var token = player["fcmToken"]
        var eventTopic = "event" + eventId
        if (token && token.length > 0) {
            if (data == true) {
                exports.subscribeToTopic(token, eventTopic)
            } else {
                exports.unsubscribeFromTopic(token, eventTopic)
            }
        }

        return exports.sendPushToTopic(title, organizerTopic, msg)
    }).then( result => { 
        var type = "joinEvent"
        if (data == false) {
            type = "leaveEvent"
        }
        return exports.createAction(type, userId, eventId, null)
    })
}

exports.onEventDeleteV1_4 = function(snapshot, context, exports, admin) {
    var eventId = context.params.eventId
    var data = snapshot.after.val()
    var old = snapshot.before

    console.log("Event delete v1.4: id " + eventId + " snapsht before " + JSON.stringify(old) + " after " + JSON.stringify(data))
    // do nothing
    // should we delete all actionIds?
    // should we delete all leagueEvents?
    // should we delete all playerEvents?
}
