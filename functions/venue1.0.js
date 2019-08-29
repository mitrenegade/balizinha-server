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
    if (userId == undefined) { 
    	return res.status(500).json({"error": "A valid user is required to create a venue"})
    }

    let name = req.body.name
    let street = req.body.street
    var lat = req.body.lat
    var lon = req.body.lon

    let cityId = req.body.cityId
    let placeId = req.body.placeId

    if (name == undefined) { return res.status(500).json({"error": "Name is required to create a venue"}) }
    if (street == undefined) { return res.status(500).json({"error": "Street is required to create a venue"}) }
    if (lat == undefined) { return res.status(500).json({"error": "Latitude is required to create a venue"}) }
    if (lon == undefined) { return res.status(500).json({"error": "Longitude is required to create a venue"}) }

    if (cityId == undefined) { return res.status(500).json({"error": "Select a city to create a venue"}) 

    console.log("Venue 1.0: createVenue cityId: " + cityId + " User lat/lon: (" + lat + ", " + lon + ")")
    let ref = `/cities/${cityId}`
    return admin.database().ref(ref).once('value').then(snapshot => {
    	if (!snapshot.exists()) {
    		return res.status(500).json({"error": "Invalid city selected!"})
    	}

    	let city = snapshot.name
    	let state = snapshot.state
    	if (city == undefined) { return res.status(500).json({"error": "Invalid name in selected city! Please select a different one."}) }
    	if (state == undefined) { return res.status(500).json({"error": "Invalid state in selected city! Please select a different one."}) }
		if (snapshot.lat != undefined && snapshot.lat != 0) {
			lat = snapshot.lat
		}
		if (snapshot.lon != undefined && snapshot.lon != 0) {
			lon = snapshot.lon
		}

		return doCreateVenue(userId, name, city, state, lat, lon, cityId, placeId)

	}
}

doCreateVenue = function(userId, name, street, city, state, lat, lon, cityId, placeId) {
    var params = {userId, name, street, city, state, lat, lon, cityId}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    if (placeId != undefined) {
    	params["placeId"] = placeId
    }

    let venueId = exports.createUniqueId()
	console.log("Venue 1.0: doCreateVenue " + venueId + ": " + JSON.stringify(params))
    let ref = `/venues/${venueId}`
    return admin.database().ref(ref).set(params).then(result => {
        // create action
        let type = globals.ActionType.createVenue
        return exports.createAction(type, userId, venueId, null)
    }).then(result => {
        return res.status(200).json({"result": result, "venueId": venueId})
    }).catch(err => {
        console.log("CreateVenue v1.0 error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}