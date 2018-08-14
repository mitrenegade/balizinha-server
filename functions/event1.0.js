exports.createEvent = function(req, res, exports, admin) {
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
        // create action
        console.log("CreateEvent v1.0 createAction event " + eventId + " organizer " + userId)
        var type = "createEvent"
        return exports.createAction(type, userId, eventId, null)
    }).then(result => {
        // join event
        console.log("CreateEvent v1.0 success for event " + eventId + " with result " + JSON.stringify(result))
        return doJoinOrLeaveEvent(userId, eventId, true, admin)
    }).then(result => {
        console.log("CreateEvent v1.0: createTopicForEvent")
        return exports.createOrganizerTopicForNewEvent(eventId, userId)
    }).then(result => {
        var placeName = city
        if (city == undefined) {
            placeName = place
        }
        return exports.pushForCreateEvent(eventId, name, place)
    }).then(result => {
        return res.status(200).json({"result": result, "eventId": eventId})
    })
    // .catch(error => {
    //     console.log("CreateEvent v1.4 error: " + JSON.stringify(error));
    //     return res.status(500).json({"error": error})
    // })
}

// helper function
doJoinOrLeaveEvent = function(userId, eventId, join, admin) {
    var params = { [userId] : join }
    return admin.database().ref(`/eventUsers/${eventId}`).update(params).then(results => {
        var params2 = { [eventId] : join }
        return admin.database().ref(`userEvents/${userId}`).update(params2)
    })
}

// cloud function
exports.joinOrLeaveEvent = function(req, res, exports, admin) {
    var userId = req.body.userId
    var eventId = req.body.eventId
    var join = req.body.join

    console.log("JoinOrLeaveEvent v1.0: " + userId + " join? " + join + " " + eventId)
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            console.log("JoinOrLeaveEvent v1.0: no player found for userId " + userId + ": must be anonymous")
            throw new Error("Please sign up to join this game")
        }
        return doJoinOrLeaveEvent(userId, eventId, join, admin)
    }).then(result => {
        console.log("JoinOrLeaveEvent v1.0: results " + JSON.stringify(result))
        return res.status(200).json({"result": result, "eventId": eventId})
    }).catch( (err) => {
        console.log("JoinOrLeaveEvent v1.0: event " + eventId + " error: " + err)
        return res.status(500).json({"error": err.message})
    })
}

// event creation/change
exports.onEventChange = function(snapshot, context, exports, admin) {
    var eventId = context.params.eventId
    var data = snapshot.after.val()
    var old = snapshot.before

    console.log("onEventChange v1.0: event " + eventId + " data " + JSON.stringify(data))

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
        return exports.sendPushToTopic(title, topic, msg).then(result => {
            return countEvents(snapshot, admin)
        })
    } else {
        console.log("event change: " + eventId)
        return snapshot
    }
}

exports.onEventCreate = function(snapshot, context, exports, admin) {
    console.log("Event v1.0: onEventCreate")
    return countEvents(snapshot, admin)
} 


// join/leave event
exports.onUserJoinOrLeaveEvent = function(snapshot, context, exports, admin) {
    const eventId = context.params.eventId
    const userId = context.params.userId
    var data = snapshot.after.val()
    var old = snapshot.before

    var eventUserChanged = false;
    var eventUserCreated = false;

    if (!old.exists()) {
        eventUserCreated = true;
        console.log("OnUserJoinOrLeaveEvent v1.0: created user " + userId + " for event " + eventId + ": " + JSON.stringify(data))
    }
    if (!eventUserCreated) {
        eventUserChanged = true;
        console.log("OnUserJoinOrLeaveEvent v1.0: updated user " + userId + " for event " + eventId + ": " + JSON.stringify(data))
    }

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        name = player["name"]
        var joinedString = "joined"
        if (data == false) {
            joinedString = "left"
        }

        var token = player["fcmToken"]
        var eventTopic = "event" + eventId
        if (token && token.length > 0) {
            if (data == true) {
                exports.subscribeToTopic(token, eventTopic)
            } else {
                exports.unsubscribeFromTopic(token, eventTopic)
            }
        }
        return name
    }).then(name => {
        var join = true
        if (data == false) {
            join = false
        }
        exports.pushForJoinEvent(eventId, name, join)
    }).then( result => { 
        var type = "joinEvent"
        if (data == false) {
            type = "leaveEvent"
        }
        return exports.createAction(type, userId, eventId, null)
    })
}

exports.onEventDelete = function(snapshot, context, exports, admin) {
    var eventId = context.params.eventId
    var data = snapshot.after.val()
    var old = snapshot.before

    console.log("Event delete v1.0: id " + eventId + " snapsht before " + JSON.stringify(old) + " after " + JSON.stringify(data))
    // do nothing
    // should we delete all actionIds?
    // should we delete all leagueEvents?
    // should we delete all playerEvents?
}

// counters

countEvents = function(snapshot, admin) {
    const parent = snapshot.ref.parent
    const leagueId = snapshot.val().league
    const countRef = admin.database().ref(`/leagues/${leagueId}/eventCount`)

    let increment = 1

    // Return the promise from countRef.transaction() so our function
    // waits for this async event to complete before it exits.
    return countRef.transaction((current) => {
        console.log("Event v1.0 countEvents for league " + leagueId + ": current " + current)
        return (current || 0) + increment;
    }).then((value) => {
        return console.log('Event v1.0: counter updated to ' + JSON.stringify(value))
    })
}

exports.recountEvents = function(snapshot, admin) {
    const countRef = snapshot.ref;
    const leagueRef = countRef.parent

    var leagueId = leagueRef.key
    console.log("Event v1.0 recountEvents for league " + leagueId)
    return admin.database().ref(`/events`).orderByChild('league').equalTo(leagueId).once('value')
    .then(leagueEventsSnapshot => {
        console.log("Event v1.0 recountEvents resulted in " + leagueEventsSnapshot.numChildren() + " events")
        var active = 0
        leagueEventsSnapshot.forEach(child => {
            console.log("event id " + child.key + " active " + child.val().active)
            if (child.val().active != false) {
                active = active + 1
            }
        })
        console.log("Event v1.0 recount results: " + active)
        return countRef.transaction((current) => {
            return active;
        }).then((value) => {
            return console.log('Event v1.0: counter recounted to ' + value);
        })
    })
}
