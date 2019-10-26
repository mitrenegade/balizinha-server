const admin = require('firebase-admin');
const globals = require('./globals')

exports.getVenues = function(req, res) {
	let ref = `/venues`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(500).json({"error": "No venues found"})
		} else {
			var allObjects = snapshot.val()
			var results = {}
	        Object.keys(allObjects).forEach(function(key) {
    	        var value = allObjects[key]
        	    value.refUrl = `${ref}/${key}`
            	results[key] = value
        	})
	 		res.status(200).json({"results": results})
		}
	})
}

exports.getCities = function(req, res) {
	let ref = `/cities`
	return admin.database().ref(ref).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		res.status(500).json({"error": "No cities found"})
		} else {
			var allObjects = snapshot.val()
			var results = {}
	        Object.keys(allObjects).forEach(function(key) {
    	        var value = allObjects[key]
        	    value.refUrl = `${ref}/${key}`
            	results[key] = value
        	})
	 		res.status(200).json({"results": results})
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
    var type = req.body.type
    if (type == undefined) { 
    	type = "unknown"
    }
    let street = req.body.street
    var lat = req.body.lat
    var lon = req.body.lon
    let city = req.body.city
    let state = req.body.state
    let placeId = req.body.placeId

    if (name == undefined) { return res.status(500).json({"error": "Name is required to create a venue"}) }
    if (street == undefined) { return res.status(500).json({"error": "Street is required to create a venue"}) }
    if (lat == undefined) { return res.status(500).json({"error": "Latitude is required to create a venue"}) }
    if (lon == undefined) { return res.status(500).json({"error": "Longitude is required to create a venue"}) }
    if (city == undefined) { return res.status(500).json({"error": "Select a city to create a venue"}) }
    if (state == undefined) { return res.status(500).json({"error": "Select a state to create a venue"}) }

    if (typeof lat != "number") { return res.status(500).json({"error": "Latitude is not a valid number"})}
    if (typeof lon != "number") { return res.status(500).json({"error": "Longitude is not a valid number"})}
    if (lat == 0 || lon == 0) { return res.status(500).json({"error": "Invalid latitude and longitude for venue"})}

    console.log("Venue 1.0: createVenue city: " + city + " state " + state +  " User lat/lon: (" + lat + ", " + lon + ") placeId: " + placeId)
 //    let ref = `/cities/${cityId}`
 //    return admin.database().ref(ref).once('value').then(snapshot => {
 //    	if (!snapshot.exists()) {
 //    		return res.status(500).json({"error": "Invalid city selected!"})
 //    	}

 //    	let city = snapshot.name
 //    	let state = snapshot.state
 //    	if (city == undefined) { return res.status(500).json({"error": "Invalid name in selected city! Please select a different one."}) }
 //    	if (state == undefined) { return res.status(500).json({"error": "Invalid state in selected city! Please select a different one."}) }
	// 	if (snapshot.lat != undefined && snapshot.lat != 0) {
	// 		lat = snapshot.lat
	// 	}
	// 	if (snapshot.lon != undefined && snapshot.lon != 0) {
	// 		lon = snapshot.lon
	// 	}

	// 	return doCreateVenue(userId, name, city, state, lat, lon, cityId, placeId)
	// })
    let venueId = exports.createUniqueId()
	return doCreateVenue(venueId, userId, name, type, street, city, state, lat, lon, placeId).then(results => {
        // create action
        let type = globals.ActionType.createVenue
        return exports.createAction(type, userId, venueId, `A new venue was created`)
    }).then(result => {
        return res.status(200).json({"success": true, "venueId": venueId})
    }).catch(err => {
        console.log("CreateVenue v1.0 error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}

doCreateVenue = function(venueId, userId, name, type, street, city, state, lat, lon, placeId) {
    var params = {userId, name, type, street, city, state, lat, lon}
    var createdAt = globals.secondsSince1970()
    params["createdAt"] = createdAt
    if (placeId != undefined) {
    	params["placeId"] = placeId
    }

	console.log("Venue 1.0: doCreateVenue " + venueId + ": " + JSON.stringify(params))
    let ref = `/venues/${venueId}`
    return admin.database().ref(ref).set(params)
}