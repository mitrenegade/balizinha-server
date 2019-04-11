const admin = require('firebase-admin');

exports.cancelEvent = function(req, res, exports) {
	let eventId = req.body.eventId
	if (eventId == undefined) {
 		return res.status(500).json({"error": "Event not found"})
 	}
	let isCancelled = req.body.isCancelled
	if (isCancelled == undefined) {
 		return res.status(500).json({"error": "Did not specify whether event was to be cancelled"})
 	}
 	console.log("Event 1.1: cancelEvent eventId " + eventId + " isCancelled " + isCancelled)
	return changeEventCancellationStatus(eventId, isCancelled).then(results => {
        // create action
        console.log("Event v1.1 createAction for cancelEvent event " + eventId)
        var type = "cancelEvent"
        var defaultMessage = "cancelled an event"
        if (isCancelled == false) {
        	type = "uncancelEvent"
        	defaultMessage = "reinstated an event"
        }
        return exports.createAction(type, organizerId, eventId, null, defaultMessage)
	}).then(() => {
		return res.status(200).json({"success": true})
	}).catch(err => {
        console.log("Event v1.1 cancelEvent error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
	})
}

changeEventCancellationStatus = function(eventId, isCancelled) {
	let eventRef = `/events/${eventId}`
	var organizerId = undefined

	// deprecated: active = true/false. use status = active or cancelled instead
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
		console.log("Event v1.1: updated event with params " + JSON.stringify(params))
		return admin.database().ref(eventRef).update(params)
	}).then(() => {
		params["organizerId"] = organizerId
		return params
	})
}