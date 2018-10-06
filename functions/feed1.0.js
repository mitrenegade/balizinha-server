exports.createFeedItem = function(req, res, exports, admin) {
	let type = req.body.type
	let userId = req.body.userId
	let leagueId = req.body.leagueId
	let eventId = req.body.eventId
	let message = req.body.message
	let defaultMessage = req.body.defaultMessage
    console.log("createFeedItem type: " + type + " league id: " + leagueId + " event id: " + eventId + " message: " + message)

    doCreateFeedItem(type, userId, leagueId, eventId, message, defaultMessage)
}

doCreateFeedItem = function(type, userId, leagueId, eventId, message, defaultMessage, exports, admin) {
    var feedItemId = exports.createUniqueId()

    var params = {}
    params["type"] = type
    if (leagueId != undefined) {
	    params["leagueId"] = leagueId
	}
	if (eventId != undefined) {
	    params["eventId"] = eventId
	}
    params["user"] = userId
    params["message"] = message
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    if (defaultMessage != undefined) {
        params["defaultMessage"] = defaultMessage
    }

    var ref = `/feedItems/` + feedItemId
    return admin.database().ref(ref).set(params).then(feedItem => {
        // create eventAction
        // BOBBY TODO: when a chat is created under event, a feedItem should be created with a different type than message or photo
        // create feedItem with type eventChat, with actionId
        // feedItems loaded with actionId should load the action and display it
        // or, events with actionId that is actually a feedItem should load a feedItem instead
    })
}
