const admin = require('firebase-admin');
// types supported by mobile client:
// chat
// photo
// other
// action

exports.createFeedItem = function(req, res, exports, admin) {
	let type = req.body.type
    let feedItemId = req.body.id
	let userId = req.body.userId
	let leagueId = req.body.leagueId
	let message = req.body.message
	let defaultMessage = req.body.defaultMessage
    console.log("createFeedItem type: " + type + " league id: " + leagueId + " message: " + message)

    return doCreateFeedItem(feedItemId, type, userId, leagueId, undefined, undefined, message, defaultMessage, exports, admin).then(feedItem => {
        // create eventAction
        // BOBBY TODO: when a chat is created under event, a feedItem should be created with a different type than message or photo
        // create feedItem with type eventChat, with actionId
        // feedItems loaded with actionId should load the action and display it
        // or, events with actionId that is actually a feedItem should load a feedItem instead
        return exports.pushForLeagueFeedItem(leagueId, type, userId, message)
    }).then(() => {
    	res.status(200).json({"result": "success"})
    }).catch(function(error) {
    	res.status(500).json({"error": error.message})
    })
}

exports.createFeedItemForJoinLeaveLeague = function(userId, leagueId, isJoin, exports, admin) {
    // create a feed item when something happens in the league, ie join
    var type = "action"
    var name = "Someone"
    console.log("createFeedItemForJoinLeaveLeague: userId " + userId + " leagueId " + leagueId)
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            console.log("createFeedItemForJoinLeaveLeague: no player found")
            throw new Error("Invalid player")
        }
        name = snapshot.val().name
        let ref = `/leagues/` + leagueId
        return admin.database().ref(ref).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            console.log("createFeedItemForJoinLeaveLeague: no league found")
            throw new Error("Invalid league")
        }
        let league = snapshot.val().name
        var joinString = " joined "
        if (!isJoin) {
            joinString = " left "
        }
        let message = name + joinString + league
        let defaultMessage = message
        let id = exports.createUniqueId()
        console.log("createFeedItemForJoinLeague: creating feedItem with message " + message)
        return doCreateFeedItem(id, type, userId, leagueId, undefined, undefined, message, defaultMessage, exports, admin)
    })
}

exports.createFeedItemForEventAction = function(type, userId, actionId, message, defaultMessage, exports, admin) {
    var eventId = undefined
    var username = undefined

    let id = exports.createUniqueId()
    let ref = `/actions/` + actionId
    return admin.database().ref(ref).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            return
        }
        eventId = snapshot.val().eventId
        if (eventId == undefined) {
            eventId = snapshot.val().event
        }
        username = snapshot.val().username

        let ref = `/events/` + eventId
        return admin.database().ref(ref).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            return
        }

        var leagueId = snapshot.val().leagueId
        if (leagueId == undefined) {
            leagueId = snapshot.val().league
        }
        var eventName = snapshot.val().name
        var feedMessage = message
        if (type == "createEvent") {
            feedMessage = username + " created the event: " + eventName
        } else if (type == "joinEvent") {
            feedMessage = username + " joined " + eventName
        } else if (type == "leaveEvent") {
            feedMessage = username + " left " + eventName
        } else if (type == "chat") {
            feedMessage = username + " said: " + message
        } else {
            feedMessage = undefined
        }

        console.log("createFeedItemForEventAction: type " + type + " leagueId " + leagueId + " actionId " + actionId + " message " + message + " default " + defaultMessage)
        return doCreateFeedItem(id, "action", userId, leagueId, actionId, eventId, feedMessage, feedMessage, exports, admin)
    })
}


doCreateFeedItem = function(id, type, userId, leagueId, actionId, eventId, message, defaultMessage, exports, admin) {
    
    var params = {"userId": userId}
    var feedItemId = id // unique id might be generated by image upload
    if (id == undefined) {
        feedItemId = exports.createUniqueId()
    }
    params["type"] = type
    if (leagueId != undefined) {
	    params["leagueId"] = leagueId
	}
    if (actionId != undefined) {
        params["actionId"] = actionId
    }
    if (eventId != undefined) {
        params["eventId"] = eventId
    }
    if (message != undefined) {
        params["message"] = message
    }
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    if (defaultMessage != undefined) {
        params["defaultMessage"] = defaultMessage
    }

    if (message == undefined && defaultMessage == undefined && type != "photo") {
        params["visible"] = false
    }

    // this shouldn't happen
    if (leagueId == undefined) {
        var ref = `/feedItems/` + feedItemId
        return admin.database().ref(ref).set(params)
    } else {
        var feedItemRef = `/feedItems/` + feedItemId
        var leagueFeedRef = `/leagueFeedItems/` + leagueId
        return admin.database().ref(feedItemRef).set(params).then(result => {
            let params = {[feedItemId]: true}
            return admin.database().ref(leagueFeedRef).update(params)
        })
    }
}
