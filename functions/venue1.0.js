const admin = require('firebase-admin');

exports.getVenues = function(req, res) {
	let ref = `/venues/`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(200).json({"venues": []})
		} else {
	 		res.status(200).json({"venues": snapshot.val()})
		}
	})
}

exports.getCities = function(req, res) {
	let ref = `/cities/`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(200).json({"cities": []})
		} else {
	 		res.status(200).json({"cities": snapshot.val()})
		}
	})
}