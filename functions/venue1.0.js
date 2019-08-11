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
	var params = {"name": name, "createdAt": createdAt, "verified": false}
	if (state != undefined) {
		params["state"] = state
	}
	if (lat != undefined && lon != undefined) {
		params["lat"] = lat
		params["lon"] = lon
	}
	return admin.database().ref(ref).set(params).then(result => {
		return admin.database().ref(ref).once('value').then(snapshot => {
			if (!snapshot.exists()) {
				return res.status(500).json({"error": "Could not create new city"})
			} else {
				return res.status(200).json({"cityId": cityId, "city": snapshot.val()})
			}
		})
	})
}

exports.deleteCity = function(req, res) {
	let cityId = req.body.cityId
	console.log("Venue 1.0: deleteCity " + cityId)
	return admin.database().ref(`/cities/` + cityId).remove().then(result => {
		return admin.database().ref(`/cityPlayers/` + cityId).remove()
	}).then(result => {
		return res.status(200).json({"cityId": cityId, "success": true})
	})
}

exports.createVenue = function(req, res, exports) {
    const userId = req.body.userId
    if (userId == undefined) { res.status(500).json({"error": "A valid user is required to create a venue"}); return }

    let name = req.body.name
    let street = req.body.street
    let city = req.body.city
    let state = req.body.state
    let lat = req.body.lat
    let lon = req.body.lon

    if (name == undefined) { return res.status(500).json({"error": "Name is required to create a venue"})
    if (street == undefined) { return res.status(500).json({"error": "Street is required to create a venue"})
    if (city == undefined) { return res.status(500).json({"error": "City is required to create a venue"})
    if (state == undefined) { return res.status(500).json({"error": "State is required to create a venue"})
    if (lat == undefined) { return res.status(500).json({"error": "Latitude is required to create a venue"})
    if (lon == undefined) { return res.status(500).json({"error": "Longitude is required to create a venue"})

    var params = {"name": name, "street": street, "city": city, "state": state, "lat": lat, "lon": lon}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    params["createdBy"] = userId

    let venueId = exports.createUniqueId()
    let ref = `/venues/${venueId}`
    return admin.database().ref(ref).set(params).then(result => {
        // create action
        console.log("CreateVenue v1.0 venue " + venueId)
        let type = globals.ActionType.createVenue
        return exports.createAction(type, userId, venueId, null)
    }).then(result => {
        return res.status(200).json({"result": result, "venueId": venueId})
    }).catch(err => {
        console.log("CreateVenue v1.0 error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}