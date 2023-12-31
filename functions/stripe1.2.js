const globals = require('./globals')
const stripeConnect = require('./stripeConnect1.0')
const admin = require('firebase-admin');

const stripeToken = globals.stripeToken
const stripe = require('stripe')(stripeToken)

/* creates a subscrption object under /subscription/id
 * params: type: [owner, membershp]
 *         leagueId: String
 *         playerId: String
 * Result: { subscription object including stripeInfo }
 */
exports.createSubscription = function(req, res, exports) {
    const type = req.body.type
    const leagueId = req.body.leagueId
    const userId = req.body.userId

    const uniqueId = exports.createUniqueId() // TODO: use globals

	if (!type || !leagueId || !userId) {
		throw new Error("Create subscrption failed: missing parameter")
	}

    console.log("Stripe 1.2: CreateSubscription type " + type + " for userId " + userId + " league " + leagueId)

    // Look up the Stripe customer id written in createStripeCustomer
    return admin.database().ref(`/stripeCustomers/${userId}/customer_id`).once('value').then(snapshot => {
    	if (!snapshot.exists()) {
    		throw new Error("No Stripe customer exists; cannot create subscription")
    	}
        return snapshot.val();
    }).then(customer => {
        // Create a charge using the chargeId as the idempotency key, protecting against double charges 
        if (type != "owner") {
        	throw new Error("Cannot handle subscription for anything other than owners")
        }

        var plan
        // see stripe dashboard -> Billing -> Products -> Plans for "Panna Social Leagues"
        if (globals.isDev) {
            plan = "plan_F4VZB7vX68fd5A"
        } else {
            plan = "plan_F4VenVpeRqoIGH"
        }
        var subscription = {customer: customer, items:[{plan: plan}]};
        console.log("Stripe 1.2: CreateSubscription customer " + customer + " plan " + plan)

        return stripe.subscriptions.create(subscription);
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.2: CreateStripeSubscription success with response " + JSON.stringify(response))
        const ref = admin.database().ref(`/subscriptions/${uniqueId}`)
        var params = {}
        params.type = type
        params.leagueId = leagueId
        params.userId = userId
        params.status = "active"
        params.subscription = response
        return ref.update(params).then(result => {
        	res.status(200).json({"result": result})
        })
    }).catch((err) => {
        console.log("Stripe 1.2: CreateSubscription error " + err.message)
        const ref = admin.database().ref(`/subscriptions/${uniqueId}`)
        const params = {"error": err.message, "status": "error"}
        return ref.update(params).then(result => {
            return res.status(500).json({"error": err.message})
        })
    })
}

/**
 * loads all subscriptions from /subscriptions for current user
 * params: userId: String
 * result: [ subscriptions ]
 */
exports.getSubscriptions = function(req, res) {
    const userId = req.body.userId
    console.log("Stripe 1.2: getSubscriptions userId" + userId)

    // Look up the Stripe customer id written in createStripeCustomer
    let ref = admin.database().ref(`/subscriptions`)
    return ref.orderByChild("userId").equalTo(userId).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("No subscriptions exists for user")
        }
        console.log("Subscriptions for userId " + userId + ": " + snapshot.key)
        return snapshot
    }).then(result => {
        return res.status(200).json({'result': result})
    }).catch(err => {
        console.log("Stripe 1.2: getSubscriptions error " + err.message)
        return res.status(500).json({'error': err.message})
    })
}

/*
exports.createStripeSubscription = function(snapshot, context, exports, admin) {
//function createStripeCharge(req, res, ref) {
    var organizerId = context.params.organizerId
    var chargeId = context.params.chargeId
    var val = snapshot.after.val()

    var isTrial = val["isTrial"]
    if (!isTrial) {
        isTrial = false
    }
    const trialMonths = 1
    console.log("Stripe 1.0: CreateStripeSubscription for organizer " + organizerId + " charge id " + chargeId + " isTrial " + isTrial)
    // This onWrite will trigger whenever anything is written to the path, so
    // noop if the charge was deleted, errored out, or the Stripe API returned a result (id exists) 
    if (val === null || val.id || val.error) return null;
    // Look up the Stripe customer id written in createStripeCustomer
    return admin.database().ref(`/stripe_customers/${organizerId}/customer_id`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        // Create a charge using the chargeId as the idempotency key, protecting against double charges 
        const trialEnd = moment().add(trialMonths, 'months')
        const endDate = Math.floor(trialEnd.toDate().getTime()/1000) // to unix time

        var plan = "balizinha.organizer.monthly"
        var subscription = {customer: customer, items:[{plan: plan}]};
        if (isTrial) {
            plan = "balizinha.organizer.monthly.trial"
            subscription["trial_end"] = endDate
        }
        console.log("Stripe 1.0: CreateStripeSubscription customer " + customer + " trialEnd " + endDate + " plan " + plan)

        return stripe.subscriptions.create(subscription);
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.0: CreateStripeSubscription success with response " + response)
        const ref = admin.database().ref(`/charges/organizers/${organizerId}/${chargeId}`)
        return ref.update(response)
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        const trialEnd = moment().add(trialMonths, 'months')
        const endDate = Math.floor(trialEnd.toDate().getTime()/1000) // to unix time
        console.log("Stripe 1.0: CreateStripeSubscription error " + error.message + " trial end " + endDate)
        const ref = admin.database().ref(`/charges/organizers/${organizerId}/${chargeId}`)
        return ref.update({"error": error.message, "status": "error", "deadline": endDate})
    });
}
*/
