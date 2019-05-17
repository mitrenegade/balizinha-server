const admin = require('firebase-admin');
const globals = require('./globals')

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

exports.createCity = function(req, res) {
	let name = req.body.name
	let state = req.body.state
	let lat = req.body.lat
	let lon = req.body.lon
	let createdAt = globals.secondsSince1970()

	let cityId = globals.createUniqueId()
	let ref = `/cities/` + cityId
	var params = {"name": name, "createdAt": createdAt}
	if (state != undefined) {
		params["state"] = state
	}
	if (lat != undefined && lon != undefined) {
		params["lat"] = lat
		params["lon"] = lon
	}
	return admin.database().ref(ref).set(params).then(result => {
		return admin.database().ref(ref).once('value').then(snapshot => {
			res.status(200).json({"cityId": cityId})
		})
	})
}

exports.createVenue = function(req, res) {
	res(500).json({'error': 'Not implemented'})
}