// https://stackoverflow.com/questions/43486278/how-do-i-structure-cloud-functions-for-firebase-to-deploy-multiple-functions-fro

exports.createLeague = function(req, res, exports, admin) {
	// Use database to declare databaseRefs:
	const name = req.body.name
	const city = req.body.city
	const info = req.body.info
	const userId = req.body.userId // userId of the one who created, becomes an owner

	const leagueId = exports.createUniqueId()
    var ref = `/leagues/` + leagueId
    var params = {"name": name, "city": city, "info": info, "owner": userId}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    // TODO: name validation?
    console.log("Creating league in /leagues with unique id " + leagueId + " name: " + name + " city: " + city + " organizer: " + userId)
    return admin.database().ref(ref).set(params).then(() => {
    	console.log("creating league " + leagueId + " complete. calling joinLeague for player " + userId)
    	const status = "member"
    	return exports.doUpdatePlayerStatusV1_6(admin, userId, leagueId, status)
    }).then(result => {
    	console.log("joinLeague result " + JSON.stringify(result) + ". loading league")
    	// can't return league as a snapshot. only return the id
	    res.send(200, {'league': leagueId})
    }).catch(err => {
    	res.send(500, {'error': err})
    })
}

exports.joinLeaveLeagueV1_4 = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const isJoin = req.body.isJoin
	console.log("JoinLeaveLeague v1.4 status " + status + " userId " + userId + " leagueId " + leagueId)
	return exports.doJoinLeaveLeagueV1_4(admin, userId, leagueId, isJoin).then(result => {
		if (result["error"] != null) {
			return res.send(500, result["error"])
		} else {
			return res.send(200, {result: result})
		}
	})
}

exports.joinLeaveLeagueV1_6 = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const isJoin = req.body.isJoin
	var status = ""
	if (isJoin) {
		status = "member"
	} else {
		status = "none"
	}
	console.log("JoinLeaveLeague v1.6 status " + status + " userId " + userId + " leagueId " + leagueId)
	return exports.doUpdatePlayerStatusV1_6(admin, userId, leagueId, status).then(result => {
		console.log("JoinLeaveLeague v1.6: success " + JSON.stringify(result))
		return res.send(200, {result: result})
	}).catch( (err) => {
    	console.log("JoinLeaveLeague v1.6: league " + leagueId + " error: " + err)
    	return res.send(500, {"error": err})
    })

}

exports.doJoinLeaveLeagueV1_4 = function(admin, userId, leagueId, isJoin) {
	// when joining a league, /leaguePlayers/leagueId gets a new attribute of [playerId:true]
	var status = ""
	if (isJoin) {
		status = "member"
	} else {
		status = "none"
	}

	console.log("DoJoinLeaveLeagueV1_4: status " + status)

	var ref = `/leagues/${leagueId}` 
	return admin.database().ref(ref).once('value')
	.then(snapshot => {
        return snapshot.val();
    }).then(league => {	
    	if (league == null) {
    		console.log("JoinLeaveLeague v1.4: league not found")
    		throw new Error("League not found")
    	} else {
    		var leagueRef = `/leaguePlayers/${leagueId}`
    		var params = {[userId]: status}
		    console.log("JoinLeaveLeague v1.4: update leaguePlayers status " + status + " + user " + userId + " league " + leagueId + " name: " + league["name"])
    		return admin.database().ref(leagueRef).update(params)
    	}
    }).then(result => {
	    console.log("JoinLeaveLeague v1.4: update playerLeagues status " + status + " league " + leagueId + " user " + userId)
		var leagueRef = `/playerLeagues/${userId}`
		var params = {[leagueId]: status}
		return admin.database().ref(leagueRef).update(params)
	}).then(result => {
		// result is null due to update
		return {"result": "success", "userId": userId, "leagueId": leagueId, "status": status}
    }).catch( (err) => {
    	console.log("JoinLeaveLeague v1.4: league " + leagueId + " error: " + err)
    	return {"error": err}
    })
}

// helper function for all changes in league membership
exports.doUpdatePlayerStatusV1_6 = function(admin, userId, leagueId, status) {
	console.log("DoUpdatePlayerStatus v1.6: userId " + userId + " leagueId " + leagueId + " status " + status)

	    // validation
    if (status != "member" && status != "organizer" && status != "owner" && status != "none") {
    	throw new Error({"message": "Invalid status. Cannot change user to " + status, "userId": userId})
    	return
    }

	var ref = `/leagues/${leagueId}` 
	return admin.database().ref(ref).once('value')
	.then(snapshot => {
		if (snapshot.val() == null) {
    		console.log("DoUpdatePlayerStatus v1.6: league not found")
    		throw new Error("League not found")
		}
        return snapshot.val()
    }).then(league => {
		var leagueRef = `/leaguePlayers/${leagueId}`
		var params = {[userId]: status}
	    console.log("DoUpdatePlayerStatus v1.6: update leaguePlayers status " + status + " + user " + userId + " league " + leagueId + " name: " + league["name"])
		return admin.database().ref(leagueRef).update(params)
    }).then(result => {
	    console.log("DoUpdatePlayerStatus v1.6: update playerLeagues status " + status + " league " + leagueId + " user " + userId)
		var leagueRef = `/playerLeagues/${userId}`
		var params = {[leagueId]: status}
		return admin.database().ref(leagueRef).update(params)
	}).then(result => {
		// result is null due to update
		return {"result": "success", "userId": userId, "leagueId": leagueId, "status": status}
	})
}


exports.getPlayersForLeague = function(req, res, exports, admin) {
	// leaguePlayers/leagueId will return all players, with a status of {player, organizer, none}
	const leagueId = req.body.leagueId
	var leagueRef = `/leaguePlayers/${leagueId}`
	console.log("getPlayersForLeague " + leagueId + " using ref " + admin.database().ref(leagueRef))
	return admin.database().ref(leagueRef).once('value').then(snapshot => {
		return snapshot.val()
	}).then(result => {
		return res.send(200, {"result": result})
	}).catch( err => {
		return res.send(500, {"error": error})
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
	console.log("getLeaguesForPlayer " + userId)
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
		return res.send(500, {"error": error})
	})

	// TODO: result sends back leaguePlayers structure, not just the id
}

// organizers
exports.changeLeaguePlayerStatusV1_4 = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const status = req.body.status
	var ref = `/leagues/${leagueId}` 
    console.log("ChangeLeaguePlayerStatus v1.4: user " + userId + " league " + leagueId + " status: " + status)
    // validation
    if (status != "member" && status != "organizer" && status != "owner" && status != "none") {
    	res.send(500, {"error": "invalid status. cannot change user " + userId + " to " + status})
    	return
    }

	var leagueRef = `/leaguePlayers/${leagueId}/${userId}`
		console.log("ChangeLeaguePlayerStatus: leaguePlayers/" + leagueId + " player " + userId + " status " + status)
	return admin.database().ref(leagueRef).set(status).then(result => {
		var playerRef = `/playerLeagues/${userId}/${leagueId}`
		console.log("ChangeLeaguePlayerStatus: playerLeagues/" + userId + " league " + leagueId + " status " + status)
		return admin.database().ref(playerRef).set(status)
	}).then(result => {
		// result is null due to update
		return res.send(200,  {"result": "success"})
    }).catch( (err) => {
    	console.log("ChangeLeaguePlayerStatus: league " + leagueId + " error: " + err)
    	return res.send(500, {"error": err})
    })
}

exports.changeLeaguePlayerStatusV1_6 = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const status = req.body.status
    console.log("ChangeLeaguePlayerStatus v1.6: user " + userId + " league " + leagueId + " status: " + status)

    return exports.doUpdatePlayerStatusV1_6(admin, userId, leagueId, status).then(result => {
		console.log("ChangeLeaguePlayerStatus v1.6: success " + JSON.stringify(result))
		return res.send(200, {result: result})
	}).catch( (err) => {
    	console.log("ChangeLeaguePlayerStatus v1.6: league " + leagueId + " error: " + err)
    	return res.send(500, {"error": err})
    })
}

exports.getEventsForLeague = function(req, res, exports, admin) {
	const leagueId = req.body.leagueId
	// var leagueRef = `/leaguePlayers/${leagueId}`
	// console.log("getPlayersForLeague " + leagueId + " using ref " + admin.database().ref(leagueRef))
	// return admin.database().ref(leagueRef).once('value').then(snapshot => {
	// 	return snapshot.val()
	// }).then(result => {
	// 	res.send(200, {"result": result})
	// }).catch( err => {
	// 	res.send(500, {"error": error})
	// })

	// find all leagueId where playerId = true
	var ref = admin.database().ref("events")
	console.log("getEventsForLeague " + leagueId)
	return ref.orderByChild("league").equalTo(leagueId).once('value').then(snapshot => {
		console.log("orderByChild for league " + leagueId + " result: " + JSON.stringify(snapshot))
		return snapshot.val()
	}).then(result => {
		return res.send(200, {"result": result})
	}).catch( err => {
		return res.send(500, {"error": error})
	})
	// TODO: result does not filter out players with value false
}