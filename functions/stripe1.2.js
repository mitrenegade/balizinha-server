const globals = require('./globals')
const stripeConnect = require('./stripeConnect1.0')
const admin = require('firebase-admin');

const stripeToken = globals.stripeToken
const stripe = require('stripe')(stripeToken)

// creates a subscrption object under /subscription/id
// Input params:
// type: [owner, membershp]
// leagueId: String
// amount: Int in cents
// playerId: String
//
// Output:
// stripeId: String of subscription object created on Stripe
exports.createSubscription = function(req, res, exports) {
    const type = req.body.type
    const leagueId = req.body.leagueId
    const playerId = req.body.playerId

    const uniqueId = exports.createUniqueId() // TODO: use globals

	if (!type || !leagueId || !amount || !playerId) {
		throw new Error("Create subscrption failed: missing parameter")
	}

    console.log("Stripe 1.2: CreateSubscription type " + type + " for player " + playerId + " league " + leagueId + " for $" + req.body.amount)

    // Look up the Stripe customer id written in createStripeCustomer
    return admin.database().ref(`/stripeCustomers/${playerId}/customer_id`).once('value').then(snapshot => {
    	if (!snapshot.exsts()) {
    		throw new Error("No Stripe customer exists; cannot create subscription")
    	}
        return snapshot.val();
    }).then(customer => {
        // Create a charge using the chargeId as the idempotency key, protecting against double charges 
        if (type != "owner") {
        	throw new Error("Cannot handle subscription for anything other than owners")
        }
        var plan = "balizinha.organizer.monthly" // type for owners
        var subscription = {customer: customer, items:[{plan: plan}]};
        console.log("Stripe 1.2: CreateSubscription customer " + customer + " plan " + plan)

        return stripe.subscriptions.create(subscription);
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.2: CreateStripeSubscription success with response " + response)
        const ref = admin.database().ref(`/subscription/${uniqueId}`)
        var params = response
        params.type = type
        params.leagueId = leagueId
        params.playerId = playerId
        return ref.update(params).then(result => {
        	res.status(200).json({"result": result})
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("Stripe 1.2: CreateSubscription stripe error " + error.message)
        const ref = admin.database().ref(`/subscriptions/${uniqueId}`)
        const params = {"error": error.message, "status": "error"}
        return ref.update(params).then(result => {
        	throw error
        })
    }).catch((err) => {
        console.log("Stripe 1.2: CreateSubscrpton caught err " + JSON.stringify(err))
        return res.status(500).json({"error": err})
    })
}
