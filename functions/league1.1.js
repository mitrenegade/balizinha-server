const admin = require('firebase-admin');
// https://stackoverflow.com/questions/43486278/how-do-i-structure-cloud-functions-for-firebase-to-deploy-multiple-functions-fro
const globals = require('./globals')

/*
 * params: userId
 * results: {leagues: [League]}
 // not used
 */
exports.getLeaguesOwnedByUser = function(req, res) {
	let userId = req.body.userId
	if (userId == undefined) {
		return res.status(500).json("Invalid owner user id")
	}
	return doGetOwnerLeagues(userId).then(results => {
		console.log("League 1.1: getLeaguesOwnedByUser results " + JSON.stringify(results, null, " "))
		return res.status(200).json(results)
	}).catch(err => {
		if (err.message == "User is not part of any leagues") {
			return res.status(200).json({'leagues': []})
		} else {
	        console.log("League 1.1: getOwnerLeaguesAndSubscriptions: userId " + userId + " error: " + err)
	        return res.status(500).json({"error": err.message})
		}
	})
}

/*
 * params: userId
 * results: {leagues: [League], subscriptions: [Subscription]}
 */
exports.getOwnerLeaguesAndSubscriptions = function(req, res) {
	let userId = req.body.userId
	if (userId == undefined) {
		return res.status(500).json("Invalid owner user id")
	}
    var promises = []

    return doGetOwnerLeagues(userId).then(leagues => {
    	if (leagues.count == 0) {
    		throw new Error("User is not part of any leagues")
    	}

    	// TODO for each league, add a promise to load its stripe subscription
	}).catch(err => {
		if (err.message == "User is not part of any leagues") {
			return res.status(200).json({'leagues': [], 'subscriptions': []})
		} else {
	        console.log("League 1.1: getOwnerLeaguesAndSubscriptions: userId " + userId + " error: " + err)
	        return res.status(500).json({"error": err.message})
		}
	})
}

// returns: {results: [League] where league.owner = userId }
doGetOwnerLeagues = function(userId) {
    return admin.database().ref(`/leagues`).orderByChild('owner').equalTo(userId).once('value').then(snapshot => {
    	if (!snapshot.exists()) {
    		throw new Error("User is not part of any leagues")
    	}
    	return {leagues: snapshot.val()}
	})
}