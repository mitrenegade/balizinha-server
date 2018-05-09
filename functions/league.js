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
    	console.log("creating league ${leagueId} complete. calling joinLeague for player ${userId}")
    	return exports.doJoinLeague(admin, userId, leagueId)
    }).then(result => {
    	console.log("joinLeague result " + JSON.stringify(result) + ". loading league")
    	return admin.database().ref(ref).once('value')
    }).then(snapshot => {
	    res.send(200, {'league': snapshot.val()})
    })
}

exports.joinLeague = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	return exports.doJoinLeague(admin, userId, leagueId).then(result => {
		if (result["error"] != null) {
			res.send(500, result["error"])
		} else {
			res.send(200, {result: result})
		}
	})
}

exports.doJoinLeague = function(admin, userId, leagueId) {
	// when joining a league, /leaguePlayers/leagueId gets a new attribute of [playerId:true]
	var ref = `/leagues/${leagueId}` 
	return admin.database().ref(ref).once('value')
	.then(snapshot => {
        return snapshot.val();
    }).then(league => {	
    	if (league == null) {
    		console.log("JoinLeague: league not found")
    		throw new Error("League not found")
    	} else {
		    console.log("JoinLeague: user " + userId + " being added to league " + leagueId + " name: " + league["name"])
    		var leagueRef = `/leaguePlayers/${leagueId}`
    		var params = {[userId]: "member"}
    		return admin.database().ref(leagueRef).update(params)
    	}
	}).then(result => {
		// result is null due to update
		return {"result": "success"}
    }).catch( (err) => {
    	console.log("JoinLeague: league " + leagueId + " error: " + err)
    	return {"error": err}
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
		res.send(200, {"result": result})
	}).catch( err => {
		res.send(500, {"error": error})
	})

	// TODO: result does not filter out players with value false
}

exports.getLeaguesForPlayer = function(req, res, exports, admin) {
	// leaguePlayers/leagueId/player can be queried for existence of userId
	// query documentation: https://firebase.google.com/docs/reference/js/firebase.database.Query
	// for alternatives using assignment, see https://stackoverflow.com/questions/41527058/many-to-many-relationship-in-firebase
	const userId = req.body.userId
	// find all leagueId where playerId = true
	var ref = admin.database().ref("leaguePlayers")
	console.log("getLeaguesForPlayer " + userId)
	return ref.orderByChild(userId).equalTo(true).once('value').then(snapshot => {
		console.log("orderByChild for userId " + userId)
		return snapshot.val()
	}).then(result => {
		res.send(200, {"result": result})
	}).catch( err => {
		res.send(500, {"error": error})
	})

	// TODO: result sends back leaguePlayers structure, not just the id
}

// organizers
exports.changeLeaguePlayerStatus = function(req, res, exports, admin) {
	const userId = req.body.userId
	const leagueId = req.body.leagueId
	const status = req.body.status
	var ref = `/leagues/${leagueId}` 
    console.log("ChangeLeaguePlayerStatus: user " + userId + " league " + leagueId + " status: " + status)
    // validation
    if (status != "member" && status != "organizer" && status != "owner" && status != "inactive") {
    	res.send(500, {"error": "invalid status"})
    	return
    }

	var leagueRef = `/leaguePlayers/${leagueId}/${userId}`
	return admin.database().ref(leagueRef).set(status).then(result => {
		// result is null due to update
		res.send(200,  {"result": "success"})
    }).catch( (err) => {
    	console.log("ChangeLeaguePlayerStatus: league " + leagueId + " error: " + err)
    	res.send(500, {"error": err})
    })
}