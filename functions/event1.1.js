const admin = require('firebase-admin');

exports.cancelEvent = function(req, res, exports) {
	let eventId = req.body.eventId
	if (eventId == undefined) {
 		return res.status(500).json({"error": "Event not found"})
 	}

	let eventRef = `/events/${eventId}`
	return admin.database().ref(eventRef).once('value').then(snapshot => {
		if (!snapshot.exists()) {
	 		return res.status(500).json({"error": "Event not found"})
		}
		// deprecated: active = true/false. use status = active or cancelled instead
		let params = {"active": false, "status": "cancelled"}
		return admin.database().ref(eventRef).update(params)
	}).then(() => {
		return res.status(200).json({"success": true})
	})
}
