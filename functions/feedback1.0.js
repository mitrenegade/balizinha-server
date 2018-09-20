exports.submitFeedback = function(req, res, exports, admin) {
	const userId = req.body.userId
	const subject = req.body.subject
	const email = req.body.email
	const details = req.body.details

	const feedbackId = exports.createUniqueId()
    var ref = `/feedback/` + feedbackId
    var params = {"userId": userId, "subject": subject, "email": email}
    if (details != undefined) {
    	params["details"] = details
    }
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    return admin.database().ref(ref).set(params).then(result => {
    	console.log("Feedback submitted: " + feedbackId + " by " + userId)
        res.send(200, {'result': JSON.stringify(result)})
    }).catch(err => {
    	res.send(500, {'error': err.message})
    })
}

