const admin = require('firebase-admin');
// https://stackoverflow.com/questions/43486278/how-do-i-structure-cloud-functions-for-firebase-to-deploy-multiple-functions-fro
const globals = require('./globals')

exports.getOwnerLeaguesAndSubscriptions = function(req, res) {
	let userId = req.body.userId
	if (userId == undefined) {
		return res.status(500).json("Invalid owner user id")
	}
    var promises = []

    return admin.database().ref(`/leagues`).orderedByChild('owner').equalTo(userId).once('value').then(snapshot => {
    	if (!snapshot.exists()) {
    		throw new Error("User is not part of any leagues")
    	}

	}).catch(err => {
		if (err.message == "User is not part of any leagues") {
			return res.status(200).json({'leagues': [], 'subscriptions': []})
		} else {
	        console.log("getOwnerLeaguesAndSubscriptions: userId " + userId + " error: " + err)
	        return res.status(500).json({"error": err.message})
		}
	})
}