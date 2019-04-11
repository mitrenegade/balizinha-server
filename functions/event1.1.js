const admin = require('firebase-admin');

exports.cancelEvent = function(req, res, exports) {
	let eventId = req.body.eventId
	if (eventId == undefined) {
 		return res.status(500).json({"error": "Event not found"})
 	}

	let eventRef = `/events/${eventId}`
	var organizerId = undefined
	return admin.database().ref(eventRef).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		return res.status(500).json({"error": "Event not found"})
		}
		organizerId = snapshot.val()["organizer"]
		// deprecated: active = true/false. use status = active or cancelled instead
		let params = {"active": false, "status": "cancelled"}
		return admin.database().ref(eventRef).update(params)
	}).then(() => {
        // create action
        console.log("Event v1.1 cancelEvent event " + eventId)
        var type = "cancelEvent"
        return exports.createAction(type, organizerId, eventId, null, "cancelled an event")
	}).then(() => {
		return res.status(200).json({"success": true})
	})
}
