const admin = require('firebase-admin');
const globals = require('./globals')
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
    params["owner"] = userId // old apps still use this info
    params["leagueId"] = league
    params["league"] = league

    // optional params
    if (paymentRequired) { params["paymentRequired"] = paymentRequired }
    if (amount) { params["amount"] = amount }
    if (state) { params["state"] = state }
    if (info) { params["info"] = info }
    if (lat) { params["lat"] = lat }
    if (lon) { params["lon"] = lon }

    let eventId = exports.createUniqueId()
    let leagueRef = `/leagues/${league}`
    return admin.database().ref(leagueRef).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            params["leagueIsPrivate"] = false
        } else {
            params["leagueIsPrivate"] = snapshot.val().isPrivate
        }

        let ref = `/events/` + eventId
        return admin.database().ref(ref).set(params)
    }).then(result => {
        // create action
        var type = globals.ActionType.createEvent
        return exports.createAction(type, userId, eventId, null)
    }).then(result => {
        // join event
        console.log("CreateEvent v1.0 success for event " + eventId + " with result " + JSON.stringify(result))
        return exports.doJoinOrLeaveEvent(userId, eventId, true, admin)
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
        console.error("Event 1.0: createEvent error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}

// helper function
exports.doJoinOrLeaveEvent = function(userId, eventId, join, admin) {
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
    var addedByOrganizer = req.body.addedByOrganizer
    var removedByOrganizer = req.body.removedByOrganizer
    var leagueId = undefined
    console.log("JoinOrLeaveEvent v1.0: " + userId + " join? " + join + " " + eventId)

    var promise
    if (join == true) {
        promise = admin.database().ref(`/events/${eventId}`).once('value').then(snapshot => {
             //////////// Find event's league and add event to default league if necessary
            if (!snapshot.exists()) {
                // event doesn't exist
                console.error("Event 1.0: joinOrLeaveEvent: could not find event " + eventId)
                throw new Error("Could not join event; event not found")
            }
            leagueId = snapshot.val().leagueId
            if (leagueId == undefined) {
                leagueId = snapshot.val().league
            }
            // find if league contains that player
            return admin.database().ref(`/leaguePlayers/${leagueId}/${userId}`).once('value')
        }).then(snapshot => { //////////// Find league's players and add player to league if necessary
            if (!snapshot.exists() || (snapshot.val() != "member" && snapshot.val() != "organizer")) {
                // player is not part of the same league
                // for backwards compatibility - add user to league. for games that are paid, the app process
                // payment first (as of 1.0.5) so the user should not be rejected after payment
                const status = "member"
                return exports.doUpdatePlayerStatus(admin, userId, leagueId, status).then(() => {
                    return exports.subscribeToLeague(leagueId, userId, true)
                }).then(() => {
                    // return player
                    return admin.database().ref(`/players/${userId}`).once('value')
                })
            } else {
                // load player
                return admin.database().ref(`/players/${userId}`).once('value')
            }
        }).then(snapshot => { /////////// Load player and join event; filters for anonymous players
            if (!snapshot.exists()) {
                console.error("Event 1.0: joinOrLeaveEvent: no player found for userId " + userId + ": must be anonymous")
                throw new Error("Please sign up to join this game")
            }
            return exports.doJoinOrLeaveEvent(userId, eventId, join, admin)
        })
    } else {
        // leaving event; does not need to check for league
        promise = admin.database().ref(`/events/${eventId}`).once('value').then(snapshot => {
             //////////// Make sure event exists
            if (!snapshot.exists()) {
                // event doesn't exist
                console.error("Event 1.0: joinOrLeaveEvent: could not find event " + eventId)
                throw new Error("Could not join event; event not found")
            }
            return exports.doJoinOrLeaveEvent(userId, eventId, join, admin)
        })
    }

    return promise.then(result => {
        if (addedByOrganizer) {
            return exports.createAction(globals.ActionType.addedToEvent, userId, eventId, null, "A player was added to this game").then(result => {
                return res.status(200).json({"result": result, "eventId": eventId})
            })
        } else if (removedByOrganizer) {
            return exports.createAction(globals.ActionType.removedFromEvent, userId, eventId, null, "A player was removed from this game").then(result => {
                return res.status(200).json({"result": result, "eventId": eventId})
            })
        } else {
            return res.status(200).json({"result": result, "eventId": eventId})
        }
    }).catch( (err) => {
        console.error("Event 1.0: joinOrLeaveEvent: event " + eventId + " error: " + err)
        return res.status(500).json({"error": err.message})
    })

}

exports.onEventCreate = function(snapshot, context, exports) {
    const eventId = context.params.eventId
    const userId = context.params.userId
    var data = snapshot.val()
    var name = data.name
    if (name == undefined) {
        name = "Panna Social Leagues"
    }
    var info = data.info
    if (info == undefined) {
        info = "Join an event on Panna and play pickup."
    }

    // count events
    const type = "events"
    return countEvents(snapshot, admin).then(() => {
        var meta = {    
            "socialTitle": name,
            "socialDescription": info
            // for now, no socialImage
        }
        return exports.createDynamicLink(type, eventId, meta)
    }).catch(err => {
        console.error("Event 1.0: onEventCreate: countEvents error " + JSON.stringify(err))
    })
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
    }
    if (!eventUserCreated) {
        eventUserChanged = true;
    }

    var join = true
    var type = globals.ActionType.joinEvent
    if (data == false) {
        join = false
        type = globals.ActionType.leaveEvent
    }
    return exports.subscribeToEvent(eventId, userId, join).then(result => {
        return admin.database().ref(`/players/${userId}`).once('value')
    }).then(snapshot => {
        var name = snapshot.val().name
        if (name == undefined) {
            name = snapshot.val().email
        }
        return exports.pushForJoinEvent(eventId, name, join)
    }).then( result => { 
        return exports.createAction(type, userId, eventId, null)
    })
}

// cloud function with promises: 
// https://stackoverflow.com/questions/43242982/cloud-functions-for-firebase-return-array-of-promises-to-gcf
exports.getEventsAvailableToUser = function(req, res, exports, admin) {
    const userId = req.body.userId
    if (userId == undefined) { res.status(500).json({"error": "A valid user is required to create event"}); return }

    // when each event is created, in addition to a leagueId, a parameter is added leagueIsPrivate
    // first, request all events where leagueIsPrivate = false
    // then, for each league belonging to the user that is private, request all events where leagueId = league.id
    var privateLeagues = []
    var objectRef = `/events`
    // get all leagues and store which ones are private
    return admin.database().ref(`/leagues`).once('value').then(snapshot => {
        snapshot.forEach(child => {
            const leagueId = child.key
            const league = child.val()
            if (league.isPrivate == true) {
                privateLeagues.push(leagueId)
            }
        })

        // load all events that are public
        let publicEventsRef = admin.database().ref(objectRef).orderByChild('leagueIsPrivate').equalTo(false).limitToLast(50)
        return publicEventsRef.once('value').then(snapshot => {
            return snapshot.val()
        })
    }).then(publicEvents => {
        // publicEvents is a dictionary of {eventId: event}
        // load all leagueIds for a player
        var userPrivateLeagues = []
        return admin.database().ref(`/playerLeagues/${userId}`).once('value').then(snapshot => {
            if (!snapshot.exists()) {
                console.error(`Event 1.0: getEventsAvailableToUser: playerLeagues for ${userId} does not exist`)
                return {}
            } else {
                snapshot.forEach(child => {
                    const leagueId = child.key
                    const membership = child.val()
                    if (membership != "none" && privateLeagues.includes(leagueId)) {
                        userPrivateLeagues.push(leagueId)
                    }
                })
            }
            return eventsForLeagues(userPrivateLeagues, admin, {})
        }).then(privateEvents => {
            var allEvents = Object.assign({}, publicEvents, privateEvents)
            var results = {}
            Object.keys(allEvents).forEach(function(key) {
                var value = allEvents[key]
                value.refUrl = `${objectRef}/${key}`
                results[key] = value
            })
            res.status(200).json({"results": results})
        })
    }).catch(err => {
        console.error("Event 1.0: getEventsAvailableToUser error " + err.message)
        res.status(500).json({"error": err.message})
    })
}

eventsForLeagues = function(leagueIds, admin, eventAccumulator) {
    return new Promise(function(resolve, reject) {
        if (leagueIds.length == 0) {
            resolve(eventAccumulator)
        }
        var leagueId = leagueIds[0]
        var remainingLeagues = leagueIds.slice(1, leagueIds.length)
        return admin.database().ref(`/events`).orderByChild('leagueId').equalTo(leagueId).once('value').then(snapshot => {
            if (snapshot.exists()) {
                var accumulatedEvents = Object.assign({}, eventAccumulator, snapshot.val())
                return eventsForLeagues(remainingLeagues, admin, accumulatedEvents).then(results => {
                    resolve(results)
                })
            } else {
                return eventsForLeagues(remainingLeagues, admin, eventAccumulator).then(results => {
                    resolve(results)
                })
            }
        })
    })
}

// counters

countEvents = function(snapshot, admin) {
    const parent = snapshot.ref.parent
    var leagueId = snapshot.val().leagueId
    if (leagueId == undefined) {
        leagueId = snapshot.val().league
    }
    let leagueRef = `/leagues/${leagueId}`
    let countRef = admin.database().ref(leagueRef).child(`eventCount`)

    // Return the promise from countRef.transaction() so our function
    // waits for this async event to complete before it exits.
    return countRef.transaction(function(current_value) {
        console.log("Event v1.0 countEvents for league " + leagueId + ": current " + current_value)
        let value = (current_value || 0) + 1;
        console.log('Event v1.0: counter updated to ' + JSON.stringify(value))
        return value
    })
}

exports.recountEvents = function(snapshot, admin) {
    const countRef = snapshot.ref;
    const leagueRef = countRef.parent
    var leagueId = leagueRef.key

    return leagueRef.once('value').then(snapshot => {
        if (!snapshot.exists()) {
            return // do not recount if league was deleted
        }
        var leagueId = leagueRef.key
        return admin.database().ref(`/events`).orderByChild('leagueId').equalTo(leagueId).once('value')
        .then(leagueEventsSnapshot => {
            var active = 0
            leagueEventsSnapshot.forEach(child => {
                if (child.val().active != false) {
                    active = active + 1
                }
            })
            return countRef.transaction((current) => {
                return active;
            }).then((value) => {
                return console.log('Event v1.0: counter recounted to ' + JSON.stringify(value));
            })
        })            
    })

}

