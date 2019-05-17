const admin = require('firebase-admin');

exports.getVenues = function(req, res) {
	let ref = `/venues/`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(500).json({"error": "No venues found"})
		} else {
	 		res.status(200).json({"results": snapshot.val()})
		}
	})
}

exports.getCities = function(req, res) {
	let ref = `/cities/`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(500).json({"error": "No cities found"})
		} else {
	 		res.status(200).json({"results": snapshot.val()})
		}
	})
}