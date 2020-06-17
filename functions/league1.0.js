const admin = require('firebase-admin');
// https://stackoverflow.com/questions/43486278/how-do-i-structure-cloud-functions-for-firebase-to-deploy-multiple-functions-fro
const globals = require('./globals')

 // deprecated league2.0
exports.createLeague = function(req, res, exports, admin) {
	// Use database to declare databaseRefs:
	const name = req.body.name
	const city = req.body.city
	const info = req.body.info
	const userId = req.body.userId // userId of the one who created, becomes an owner

	const leagueId = exports.createUniqueId()
    var ref = `/leagues/` + leagueId
    var params = {"name": name, "city": city, "info": info, "ownerId": userId}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    // TODO: name validation?
    console.log("League 1.0: Creating league in /leagues with unique id " + leagueId + " name: " + name + " city: " + city + " organizer: " + userId)
    return admin.database().ref(ref).set(params).then(() => {
    	console.log("creating league " + leagueId + " complete. calling joinLeague for player " + userId)
    	const status = "member"
    	return exports.doUpdatePlayerStatus(admin, userId, leagueId, status)
    }).then(result => {
    	// can't return league as a snapshot. only return the id
	    res.send(200, {'league': leagueId})
    }).catch(err => {
    	console.error("League 1.0: createLeague error " + JSON.stringify(err))
    	res.send(500, {'error': err.message})
    })
}

exports.onLeagueCreate = function(snapshot, context, exports, admin) {
	const id = context.params.leagueId
	const type = "leagues"
    var data = snapshot.val()
    var name = data.name
    if (name == undefined) {
    	name = "Panna Social Leagues"
    }
    var info = data.info
    if (info == undefined) {
    	info = "Join a league on Panna and play pickup."
    }
    var meta = {    
        "socialTitle": name,
        "socialDescription": info
//        "socialImageLink": "" // no image for now
    }

    return exports.createDynamicLink(type, id, meta)
}

exports.joinLeaveLeague = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const isJoin = req.body.isJoin
	var status = ""
	if (isJoin) {
		status = "member"
	} else {
		status = "none"
	}
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            console.error("League 1.0: joinLeaveLeague: no player found " + userId)
            throw new Error("Invalid player")
        }
        return exports.doUpdatePlayerStatus(admin, userId, leagueId, status)
    }).then((result) => {
		console.log("League 1.0: joinLeaveLeague: status " + status + " userId " + userId + " leagueId " + leagueId " result: " + JSON.stringify(result))
		// subscribe to league
		return exports.subscribeToLeague(leagueId, userId, isJoin)
	}).then(() => {
		return exports.createFeedItemForJoinLeaveLeague(userId, leagueId, isJoin)
	}).then(() => {
		return res.send(200, {"result": "success"})
	}).catch( (err) => {
    	console.error("League 1.0: joinLeaveLeague: league " + leagueId + " error: " + JSON.stringify(err) + " message " + err.message)
    	return res.send(500, {"error": err.message})
    })
}

// helper function for all changes in league membership
exports.doUpdatePlayerStatus = function(admin, userId, leagueId, status) {
    // validation
    if (status != "member" && status != "organizer" && status != "none") {
    	console.error(`League 1.0: doUpdatePlayerStatus invalid status ${status} for userId ${userId}`)
    	throw new Error({"message": "Invalid status. Cannot change user to " + status, "userId": userId})
    }

	var ref = `/leagues/${leagueId}` 
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
    		console.log("League v1.0 DoUpdatePlayerStatus: league not found")
    		throw new Error("League not found")
		}
		var leagueRef = `/leaguePlayers/${leagueId}`
		var params = {[userId]: status}
	    console.log("League v1.0 DoUpdatePlayerStatus: update leaguePlayers status " + status + " + user " + userId + " league " + leagueId)
		return admin.database().ref(leagueRef).update(params)
    }).then(result => {
		return countLeaguePlayers(leagueId, status, admin)
	}).then(result => {
	    console.log("League v1.0 DoUpdatePlayerStatus: update playerLeagues status " + status + " league " + leagueId + " user " + userId)
		var leagueRef = `/playerLeagues/${userId}`
		var params = {[leagueId]: status}
		return admin.database().ref(leagueRef).update(params)
	}).then(result => {
		// result is null due to update
		return {"result": "success", "userId": userId, "leagueId": leagueId, "status": status}
	})
}

countLeaguePlayers = function(leagueId, status, admin) {
	// TODO: consider old status. if we have change of membership type, this shouldn't change count
	// TODO: if an entry gets deleted, this need to be counted as well
	var leagueRef = admin.database().ref(`/leagues/${leagueId}`)
    const countRef = leagueRef.child("playerCount")
    var increment = 0
    if (status == "none") {
    	increment = -1
    } else if (status == "member" || status == "organizer") {
    	increment = 1
    }

    // Return the promise from countRef.transaction() so our function
    // waits for this async event to complete before it exits.
    return countRef.transaction((current) => {
        console.log("League v1.0 countLeaguePlayers for league " + leagueId + ": current " + current)
        return (current || 0) + increment;
    }).then((value) => {
        return console.log('League v1.0: counter updated to ' + JSON.stringify(value));
    })
}

exports.recountPlayers = function(snapshot, admin) {
    const countRef = snapshot.ref;
    const leagueRef = countRef.parent
	var leagueId = leagueRef.key

    return leagueRef.once('value').then(snapshot => {
        if (!snapshot.exists()) {
        	console.log("RecountPlayers: league " + leagueId + " no longer exists")
            return // do not recount if league was deleted
        }

	    console.log("League v1.0 recountPlayers for league " + leagueId)
	    return admin.database().ref(`/leaguePlayers/${leagueId}`).once('value')
	    .then(snapshot => {
	        var members = 0
	        snapshot.forEach(child => {
	        	const status = child.val()
	            if (status == "member" || status == "organizer") {
	                members = members + 1
	            }
	        })
	        console.log("League v1.0 recountPlayers resulted in " + snapshot.numChildren() + " players, " + members + " members")
	        return countRef.transaction((current) => {
	            return members;
	        }).then((value) => {
	            return console.log('League v1.0: counter recounted to ' + JSON.stringify(value));
	        })
	    })
	})
}

exports.getPlayersForLeague = function(req, res, exports, admin) {
	// leaguePlayers/leagueId will return all players, with a status of {player, organizer, none}
	const leagueId = req.body.leagueId
	var leagueRef = `/leaguePlayers/${leagueId}`
	return admin.database().ref(leagueRef).once('value').then(snapshot => {
		return snapshot.val()
	}).then(result => {
		return res.send(200, {"result": result})
	}).catch( err => {
		console.error(`League 1.0: getPlayersForLeague ${userId} error` + JSON.stringify(err))
		return res.send(500, {"error": err.message})
	})

	// TODO: result does not filter out players with value false
}

exports.getLeaguesForPlayer = function(req, res, exports, admin) {
	// leaguePlayers/leagueId/player can be queried for existence of userId
	// query documentation: https://firebase.google.com/docs/reference/js/firebase.database.Query
	// for alternatives using assignment, see https://stackoverflow.com/questions/41527058/many-to-many-relationship-in-firebase
	const userId = req.body.userId
	// find all leagueId where playerId = true
	// var ref = admin.database().ref("leaguePlayers")
	// return ref.orderByChild(userId).equalTo("member").once('value').then(snapshot => {
	// 	console.log("orderByChild for userId " + userId + " result: " + JSON.stringify(snapshot))
	// 	return snapshot.val()
	// getLeagues pulls a list of leagueIds from playerLeagues
	var ref = admin.database().ref(`playerLeagues/${userId}`)
	return ref.once('value').then(snapshot => {
		return snapshot.val()
	}).then(result => {
		return res.send(200, {"result": result})
	}).catch( err => {
		console.error(`League 1.0: getLeaguesForPlayer ${userId} error` + JSON.stringify(err))
		return res.send(500, {"error": err.message})
	})

	// TODO: result sends back leaguePlayers structure, not just the id
}

exports.changeLeaguePlayerStatus = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const status = req.body.status
    console.log("ChangeLeaguePlayerStatus v1.0: user " + userId + " league " + leagueId + " status: " + status)

    return exports.doUpdatePlayerStatus(admin, userId, leagueId, status).then(result => {
		console.log("ChangeLeaguePlayerStatus v1.0: success " + JSON.stringify(result))
		var isJoin = true
		if (status == "none") {
			isJoin = false
	    }
		return exports.subscribeToLeague(leagueId, userId, isJoin)
	}).then(() => {
		return res.send(200, {"result": "success"})
	}).catch( (err) => {
    	console.log("ChangeLeaguePlayerStatus v1.0: league " + leagueId + " error: " + JSON.stringify(err))
    	return res.send(500, {"error": err.message})
    })
}

// returns league object with refUrl
exports.getEventsForLeague = function(req, res, exports, admin) {
	const leagueId = req.body.leagueId

	// find all leagueId where playerId = true
	var objectRef = "/events"
	var ref = admin.database().ref(objectRef)
	console.log("getEventsForLeague " + leagueId)
	return ref.orderByChild("leagueId").equalTo(leagueId).once('value').then(snapshot => {
		console.log("orderByChild for league " + leagueId + " result: " + JSON.stringify(snapshot))
		return snapshot.val()
	}).then(allObjects => {
        var results = {}
        Object.keys(allObjects).forEach(function(key) {
            var value = allObjects[key]
            value.refUrl = `${objectRef}/${key}`
            results[key] = value
        })

		return res.send(200, {"result": results})
	}).catch( err => {
		return res.send(500, {"error": err.message})
	})
}

// get league stats
// this function isn't necessary if the league has been downloaded on the client. This may become useful if there are other 
// stats that need to be calculated and were not actively counted
// currently, /league/id contains counts for players and events
exports.getLeagueStats = function(req, res, exports, admin) {
	const leagueId = req.body.leagueId
	var players = 0
	var events = 0
	var leagueInfo = {}
	var ref = admin.database().ref(`/leagues/${leagueId}`).once('value').then(snapshot => {
		if (!snapshot.exists()) {
			return res.send(500, {"error": "League not found"})
		}
		const league = snapshot.val()
		const stats = {"players": league["playerCount"], "events": league["eventCount"]}
		return res.send(200, stats)
	})
	// var ref = admin.database().ref(`/leaguePlayers`).child(leagueId).orderByValue().equalTo("member").once('value').then(snapshot => {
	// 	console.log("getLeagueStats v1.0: members " + JSON.stringify(snapshot))
	// 	players = players + snapshot.numChildren()
	// 	return admin.database().ref(`/leagues/${leagueId}/eventCount`).once('value')
	// }).then(snapshot => {
	// 	console.log("getLeagueStats v1.0: eventCount " + JSON.stringify(snapshot))
	// 	if (snapshot != undefined) {
	// 		events = snapshot.val()
	// 	}
	// 	res.send(200, {"players": players, "events": events})
	// })
}
