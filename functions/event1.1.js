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
        var type = "cancelEvent"
        var defaultMessage = "cancelled an event"
        if (isCancelled == false) {
        	type = "uncancelEvent"
        	defaultMessage = "reinstated an event"
        }
        let organizerId = results["organizerId"]
        console.log("Event v1.1 createAction for cancelEvent event " + eventId + " by organizer " + organizerId)
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
		return admin.database().ref(eventRef).update(params)
	}).then(() => {
		params["organizerId"] = organizerId
		console.log("Event v1.1: updated event with params " + JSON.stringify(params))
		return params
	})
}

exports.deleteEvent = function(req, res, exports) {
	let eventId = req.body.eventId
	if (eventId == undefined) {
 		return res.status(500).json({"error": "Event not found"})
 	}
 	console.log("Event 1.1: deleteEvent eventId " + eventId)

 	return admin.database().ref(`/events/${eventId}`).remove().then(() => {
 		return admin.database().ref(`eventUsers/${eventId}`).once('value')
 	}).then(snapshot => {
        if (!snapshot.exists()) {
            console.log("Event 1.1: deleteEvent: no users found for snapshot")
            return res.status(200).json({"success": true})
        }

        var promises = []
        snapshot.forEach(child => {
            let userId = child.key
		 	let promiseRef = admin.database().ref(`/userEvents/${userId}/${eventId}`).remove()
            promises.push(promiseRef)
        })

        return Promise.all(promises)
	}).then(() => {
		return res.status(200).json({"success": true})
	}).catch(err => {
        console.log("Event v1.1 deleteEvent error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
	})
}
