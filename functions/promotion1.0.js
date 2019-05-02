const admin = require('firebase-admin');

exports.promotionWithId = function(req, res) {
    let promoId = req.body.promotionId
    return exports.getPromotion(promoId).then(result => {
    	if (result == undefined) {
    		return res.status(500).json({"error": "Invalid promotion code"})
    	} else {
    		return res.status(200).json(result)
    	}
    })
}

// helper
exports.getPromotion = function(promoId) {
	return admin.database().ref(`/promotions/${promoId}`).once('value').then(snapshot => {
		if (!snapshot.exists()) {
			return undefined
		}
		return snapshot.val()
	})
}

exports.isValidPromotionCode = function(promotion) {
	// does not return a promise!
	if (promotion == undefined) {
		return false
	}

	// check for active state
	if (promotion.active != true) { // includes undefined and false
		return false
	}

	// check for expiration
	if (promotion.expirationDate != undefined) {
        let now = new Date();
        let timediff = now.getTime() - promotion.expirationDate
        if (timediff > 0) {
        	return false
        }
	}
	return true
}