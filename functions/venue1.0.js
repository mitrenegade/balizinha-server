const admin = require('firebase-admin');

exports.getVenues = function(req, res) {
	let ref = `/venues/`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(200).json({"results": []})
		} else {
	 		res.status(200).json({"results": snapshot.val()})
		}
	})
}

exports.getCities = function(req, res) {
	let ref = `/cities/`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(200).json({"results": []})
		} else {
	 		res.status(200).json({"results": snapshot.val()})
		}
	})
}