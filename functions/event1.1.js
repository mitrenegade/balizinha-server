const admin = require('firebase-admin');

exports.cancelEvent = function(req, res, exports) {
	let eventId = req.body.eventId
	if (eventId == undefined) {
 		return res.status(500).json({"error": "Event not found"})
 	}

	return changeEventCancellationStatus(eventId, true).then(results => {
        // create action
        console.log("Event v1.1 cancelEvent event " + eventId)
        var type = "cancelEvent"
        return exports.createAction(type, organizerId, eventId, null, "cancelled an event")
	}).then(() => {
		return res.status(200).json({"success": true})
	}).catch(err => {
        console.log("Event v1.1 cancelEvent error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
	})
}

exports.uncancelEvent = function(req, res, exports) {
	let eventId = req.body.eventId
	if (eventId == undefined) {
 		return res.status(500).json({"error": "Event not found"})
 	}

	return changeEventCancellationStatus(eventId, false).then(results => {
        // create action
        console.log("Event v1.1 uncancelEvent event " + eventId)
        var type = "uncancelEvent"
        let organizerId = results["organizerId"]
        return exports.createAction(type, organizerId, eventId, null, "reinstated an event")
	}).then(() => {
		return res.status(200).json({"success": true})
	}).catch(err => {
        console.log("Event v1.1 uncancelEvent error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
	})
}

changeEventCancellationStatus = function(eventId, isCancelled) {
	let eventRef = `/events/${eventId}`
	var organizerId = undefined
	var params = {"active": !isCancelled}
	if (isCancelled == true) {
		params["status"] = "cancelled"
	} else {
		params["status"] = "active"
	}
	var organizerId = undefined
	return admin.database().ref(eventRef).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		throw new Error("Event not found")
		}
		organizerId = snapshot.val()["organizer"]
		// deprecated: active = true/false. use status = active or cancelled instead
		return admin.database().ref(eventRef).update(params)
	}).then(() => {
		params["organizerId"] = organizerId
		return params
	})
}