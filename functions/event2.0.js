const admin = require('firebase-admin');
const globals = require('./globals')
const event1_0 = require('./event1.0')

exports.createEvent = function(req, res, exports) {
    const userId = req.body.userId
    if (userId == undefined) { res.status(500).json({"error": "A valid user is required to create event"}); return }

    var league = req.body.league
    var name = req.body.name
    var type = req.body.type
    if (league == undefined) { league = DEFAULT_LEAGUE }
    if (name == undefined) { name = "Balizinha" }
    if (type == undefined) { type = "3 vs 3" }

    const startTime = req.body.startTime
    const endTime = req.body.endTime
    if (startTime == undefined) { return res.status(500).json({"error": "Start time is required to create event"}) } // error if not exist
    if (endTime == undefined) { return res.status(500).json({"error": "End time is required to create event"}) }
    if (endTime <= startTime) { return res.status(500).json({"error": "End time must be after start time for event"}) }

    const venueId = req.body.venueId
    var city = req.body.city
    var state = req.body.state
    var place = req.body.place
    var lat = req.body.lat
    var lon = req.body.lon

    var maxPlayers = req.body.maxPlayers
    if (maxPlayers == undefined) { maxPlayers = 6 }

    const info = req.body.info
    const paymentRequired = req.body.paymentRequired
    const amount = req.body.amount

    var params = {"league": league, "name": name, "type": type, "city": city, "place": place, "startTime": startTime, "endTime": endTime, "maxPlayers": maxPlayers}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    params["organizer"] = userId // old apps still use this info ??
    params["owner"] = userId // old apps still use this info
    params["organizerId"] = userId // who is allowed to modify
    params["ownerId"] = userId // who gets paid
    params["leagueId"] = league
    params["league"] = league

    var recurrence = req.body.recurrence
    if (recurrence == undefined) {
        recurrence = "none"
    }
    params["recurrence"] = recurrence

    // optional params
    if (paymentRequired) { params["paymentRequired"] = paymentRequired }
    if (amount) { params["amount"] = amount }
    if (info) { params["info"] = info }

    let eventId = exports.createUniqueId()
    var newEventIds = []
    var promises = []
    if (venueId == undefined) {
        // promises remains empty
        console.log("CreateEvent 2.0: no venueId provided")
    } else {
        let venueRef = `/venues/${venueId}`
        var promiseRef = admin.database().ref(venueRef).once('value').then().then(snapshot => {
            if (snapshot.exists()) {
                city = snapshot.val().city
                state = snapshot.val().state
                place = snapshot.val().name
                lat = snapshot.val().lat
                lon = snapshot.val().lon
                console.log("CreateEvent 2.0: loaded city, state, place, lat, lon using existing venue")
            } else {
                console.log("CreateEvent 2.0: venueId was invalid")
                throw new Error("Invalid venue specified for event")
            }
        })
        promises.push(promiseRef)
    }
    Promise.all(promises).then(result => {
        // city, state and place are required if venue is not
        if (city == undefined) { throw new Error("City is required to create event") }
        if (state == undefined) { throw new Error("State is required to create event") }
        if (place == undefined) { throw new Error("Location is required to create event") }
        if (lat == undefined || lon == undefined) { throw new Error("Latitude and longitude are required to create event") }
        if (typeof lat != "number") { throw new Error("Latitude is not a valid number") }
        if (typeof lon != "number") { throw new Error("Longitude is not a valid number") }
        if (lat == 0 || lon == 0) { throw new Error("Invalid latitude and longitude for event") }

        params["place"] = place
        params["city"] = city
        params["state"] = state
        params["lat"] = lat
        params["lon"] = lon
        if (venueId) {
            params["venueId"] = venueId
        }

        let leagueRef = `/leagues/${league}`
        return admin.database().ref(leagueRef).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            params["leagueIsPrivate"] = false
        } else {
            params["leagueIsPrivate"] = snapshot.val().isPrivate
        }

        if (recurrence == "none") {
            let ref = `/events/` + eventId
            return admin.database().ref(ref).set(params).then(result => {
                return {"eventIds": [eventId]} // createRecurringEvent returns this
            })
        } else {
            return createRecurringEvents(eventId, params, recurrence, req, exports)
        }
    }).then(result => {
        newEventIds = result["eventIds"] 
        console.log("Setting newEventIds to " + JSON.stringify(newEventIds))
        return result
    }).then(result => {
        // create action
        console.log("After Setting newEventIds, result = " + JSON.stringify(result) + " newEventIds " + JSON.stringify(newEventIds))
        var type = globals.ActionType.createEvent
        var actionPromises = []
        newEventIds.forEach(thisEventId => {
            console.log("CreateEvent v2.0 createAction organizer " + userId + " eventId " + thisEventId)
            actionPromises.push(exports.createAction(type, userId, thisEventId, null))
        })
        return Promise.all(actionPromises)
    }).then(result => {
        // join event
        console.log("CreateEvent v2.0 success for event " + eventId + " with result " + JSON.stringify(result))
        var joinPromises = []
        newEventIds.forEach(thisEventId => {
            joinPromises.push(exports.doJoinOrLeaveEvent(userId, thisEventId, true, admin))
        })
        return Promise.all(joinPromises)
    }).then(result => {
        var topicPromises = []
        newEventIds.forEach(thisEventId => {
            console.log("CreateEvent v2.0: createOrganizerTopicForNewEvent " + thisEventId + " adding organizer " + userId)
            topicPromises.push(exports.createOrganizerTopicForNewEvent(thisEventId, userId))
        })
        return Promise.all(topicPromises)
    }).then(result => {
        var placeName = city
        if (city == undefined) {
            placeName = place
        }
        return exports.pushForCreateEvent(eventId, league, name, place)
    }).then(result => {
        return res.status(200).json({"result": result, "eventId": eventId})
    }).catch(err => {
        console.log("CreateEvent v2.0 error: " + err.message);
        return res.status(500).json({"error": err.message})
    })
}

createRecurringEvents = function(eventId, params, recurrence, req, exports) {
    params["recurrenceEventId"] = eventId
    const recurrenceEndDateInterval = req.body.recurrenceEndDate
    if (recurrenceEndDateInterval == undefined) { throw new Error("End of recurrence is required for a recurring event!") } 

    const startDateInterval = params["startTime"]
    const endDateInterval = params["endTime"]
    const eventLength = endDateInterval - startDateInterval

    var eventStartDates = []
    var nextStartDate = startDateInterval
    console.log(`Event 2.0: createRecurringEvents: startDateInterval ${startDateInterval} recurrenceEndDateInterval ${recurrenceEndDateInterval} recurrence ${recurrence}`)

    while (nextStartDate <= recurrenceEndDateInterval) {
        eventStartDates.push(nextStartDate)

        if (recurrence == "daily") {
            nextStartDate = nextStartDate + 24*3600
        } else if (recurrence == "weekly") {
            nextStartDate = nextStartDate + 7*24*3600
        } else if (recurrence == "monthly") {
            var date = new Date(nextStartDate * 1000) // in milliseconds
            var hour = date.getHours()
            date.setMonth(date.getMonth()+1)
            date.setHours(hour)
            nextStartDate = date.getTime() / 1000
        }
    }

    var promises = []
    var eventIds = []
    for (i = 0; i < eventStartDates.length; i++) {
        var nextParams = params
        var newEventId = eventId
        if (i > 0) {
            newEventId = eventId + `-${i}` // use same base id
        }
        params["startTime"] = eventStartDates[i]
        params["endTime"] = eventStartDates[i] + eventLength
        let ref = `/events/` +  newEventId
        let promiseRef = admin.database().ref(ref).set(params)
        promises.push(promiseRef)
        eventIds.push(newEventId)
    }
    return Promise.all(promises).then(result => {
        return {"eventIds": eventIds}
    })
}
