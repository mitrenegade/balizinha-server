const admin = require('firebase-admin');

exports.isValidPromotionCode = function(promoId) {
	if (promoId == undefined) {
		return false
	}
	return admin.database().ref(`/promotions/${promoId}`).once('value')
	.then(snapshot => {
		if (!snapshot.exists()) {
			return false
		}
		let promo = snapshot.val()

		// check for active state
		if (promo.active != true) { // includes undefined and false
			return false
		}

		// check for expiration
		if (promo.expirationDate != undefined) {
	        let now = new Date();
            let timediff = Math.abs(now.getTime() - promo.expirationDate
            if (timediff > 0) {
            	return false
            }
		}
		return true
	})
}