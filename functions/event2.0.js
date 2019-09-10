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

    var recurrence = req.body.recurrence
    if (recurrence == undefined) { recurrence = "none"}
    if (recurrence != "none") {
        const recurrenceEndDateInterval = req.body.recurrenceEndDate
        if (recurrenceEndDateInterval == undefined) { return res.status(500).json({"error": "End of recurrence is required for a recurring event!"}) } 
    }

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

    console.log("lat " + lat + " lon " + lon)

    var params = {"league": league, "name": name, "type": type, "city": city, "place": place, "startTime": startTime, "endTime": endTime, "maxPlayers": maxPlayers}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    params["organizer"] = userId
    params["owner"] = userId // old apps still use this info
    params["leagueId"] = league
    params["league"] = league

    // optional params
    if (paymentRequired) { params["paymentRequired"] = paymentRequired }
    if (amount) { params["amount"] = amount }
    if (info) { params["info"] = info }

    let eventId = exports.createUniqueId()
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
                console.log("CreateEvent 2.0: no venueId provided")
            } else {
                console.log("CreateEvent 2.0: venueId was invalid")
                throw new Error("Invalid venue specified for event")
            }
        })
        promises.push(promiseRef)
    }
    Promise.all(promises).then(result => {
        // city, state and place are required if venue is not
        if (city == undefined) { return res.status(500).json({"error": "City is required to create event"}) }
        if (state == undefined) { return res.status(500).json({"error": "State is required to create event"}) }
        if (place == undefined) { return res.status(500).json({"error": "Location is required to create event"}) }
        if (lat == undefined || lon == undefined) { return res.status(500).json({"error": "Latitude and longitude are required to create event"}) }

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

        let ref = `/events/` + eventId
        return admin.database().ref(ref).set(params)
    }).then(result => {
        // create action
        console.log("CreateEvent v1.0 createAction event " + eventId + " organizer " + userId)
        var type = globals.ActionType.createEvent
        return exports.createAction(type, userId, eventId, null)
    }).then(result => {
        // join event
        console.log("CreateEvent v1.0 success for event " + eventId + " with result " + JSON.stringify(result))
        return event1_0.doJoinOrLeaveEvent(userId, eventId, true, admin)
    }).then(result => {
        console.log("CreateEvent v1.0: createOrganizerTopicForNewEvent " + eventId + " adding organizer " + userId)
        return exports.createOrganizerTopicForNewEvent(eventId, userId)
    }).then(result => {
        var placeName = city
        if (city == undefined) {
            placeName = place
        }
        return exports.pushForCreateEvent(eventId, league, name, place)
    }).then(result => {
        return res.status(200).json({"result": result, "eventId": eventId})
    }).catch(err => {
        console.log("CreateEvent v1.0 error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}
