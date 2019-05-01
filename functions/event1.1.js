const admin = require('firebase-admin');
const promotionService = require('./promotion1.0')

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

exports.deleteEvent = function(req, res) {
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
			return admin.database().ref(`eventUsers/${eventId}`).remove()
	}).then(() => {
		return res.status(200).json({"success": true})
	}).catch(err => {
        console.log("Event v1.1 deleteEvent error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
	})
}

exports.shouldChargeForEvent = function(req, res) {
	let eventId = req.body.eventId
	let userId = req.body.userId

	var event = undefined
	var user = undefined
	return admin.database().ref(`/events/${eventId}`).once('value')
	.then(snapshot => {
        if (!snapshot.exists()) {
            console.log("Event 1.1: shouldChargeForEvent: event " + eventId + " doesn't exists")
            throw new Error("Event not found")
        }
        event = snapshot.val()
        return admin.database().ref(`/players/${userId}`).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            console.log("Event 1.1: shouldChargeForEvent: user " + userId + " doesn't exist")
            throw new Error("User not found")
        }
        user = snapshot.val()
        return calculateAmountForEvent(user, event)
    }).then(result => {
		console.log("Event v1.1 shouldChargeForEvent result: " + JSON.stringify(result))
    	return res.status(200).json(result)
    }).catch(err => {
    	if (err.message == "Payment not required") {
    		console.log("Event v1.1 shouldChargeForEvent payment not required")
    		return res.status(200).json({"paymentRequired": false})
    	} else {
    		console.log("Event v1.1 shouldChargeForEvent error: " + JSON.stringify(err) + " message " + err.message)
    		return res.status(500).json({"error": err.message})
    	}
    })
}

calculateAmountForEvent = function(user, event) {
    let paymentRequired = event.paymentRequired
    let amount = event.amount
    if (paymentRequired == undefined || paymentRequired == false || amount == undefined || amount == 0) {
    	throw new Error("Payment not required") // not actually an error - used to break the promise chain
    }

    console.log("calculateAmountForEvent: user " + JSON.stringify(user.id) + " promo " + user.promotionId)
    if (user.promotionId == undefined) {
	    return {"paymentRequired": true, "amount": amount}
	}

	// calculate promotion
	return applyPromotionForEvent(event.amount, user.promotionId).then(result => {
		console.log("Event 1.1: calculateAmountForEvent after applying promotion: result " + JSON.stringify(result))
		return result
	}).catch(err => {
		if (err.message == "No valid promo") {
			return {"paymentRequired": true, "amount": amount}
		} else {
			console.log("Event 1.1: calculateAmountForEvent error " + JSON.stringify(err))
			throw err
		}
	})
}

applyPromotionForEvent = function(amount, promoId) {
	console.log("Event 1.1: applyPromotionForEvent: promotion " + promoId + " to amount " + amount)
	return promotionService.getPromotion(promoId).then(result => {
		let isValid = promotionService.isValidPromotionCode(result)
		if (!isValid) {
			throw new Error("No valid promo")
		}

		let value = result.value
		var amountRemaining = amount
		if (result.type == "percentDiscount") {
			amountRemaining = amount * value / 100
		} else if (result.type == "amountDiscount") {
			amountRemaining = amount - value
		} else {
			throw new Error("No valid promo")
		}
		console.log("Event 1.1: applyPromotionForEvent valid promotion" + promoId + " value " + value + " amountRemaining " + amountRemaining)
		return {"paymentRequired": amountRemaining > 0, "amount": amountRemaining}
	})
}