const globals = require('./globals')
const stripeConnect = require('./stripeConnect1.0')
const admin = require('firebase-admin');

const stripeToken = globals.stripeToken
const stripe = require('stripe')(stripeToken)
/**
 * Allows user to join a game and create a payment hold
 * params: userId: String, eventId: String
 * result: { },  or error
 */
exports.makePayment = function(req, res, exports) {
    const userId = req.body.userId
    const eventId = req.body.eventId
    const chargeId = exports.createUniqueId()

    return checkForStripeConnectForEvent(eventId).then(result => {
        const isConnectedAccount = result.type == 'stripeConnectAccount'
        const foundEvent = result.event
        console.log("holdPayment: checkForStripeConnect result " + JSON.stringify(result) + " with stripeConnectAccount? " + isConnectedAccount)
        if (isConnectedAccount) {
            const connectId = result.connectId
            const amount = foundEvent.amount * 100
            return makeConnectCharge(connectId, amount, userId, eventId, chargeId, exports)
        } else {
            return holdPaymentForPlatformCharge(userId, eventId, chargeId, exports)
        }
    }).then(result => {
        console.log("holdPayment: result " + JSON.stringify(result))
        if (result["result"] == 'error') {
            res.status(500).json(result)
        } else {
            res.status(200).json(result)
        }
    })
    .catch(err => {
        err.error = err.message
        if (err.message == "If you specify a customer when sharing a source, the source must be attached to the customer beforehand.") {
            // this happens if a user has a stripe card instead of a source associated with a costomer
            err.error = "We've upgraded our payment system. Please update your payment method and try again."
        }
        console.log("holdPayment: caught error " + JSON.stringify(err))
        res.status(500).json(err)
    })
}

makeConnectCharge = function(connectId, amount, userId, eventId, chargeId, exports) {
    console.log("holdPayment: This is a Stripe Connect user's event " + eventId + " with stripeUserId " + connectId + " amount " + amount + " userId " + userId + " chargeId " + chargeId)
    return stripeConnect.doStripeConnectCharge(amount, eventId, connectId, userId, chargeId).then(result => {
        var type = "stripeConnectChargeForEvent"
        return exports.createAction(type, userId, eventId, null, "made a payment")
    })
}


// makes a charge on Panna's platform
holdPaymentForPlatformCharge = function(userId, eventId, chargeId, exports) {
    var customer = ""
    var amount = 0

    console.log("Stripe v1.1: holdPayment userId " + userId + " event " + eventId + " new charge " + chargeId)
    const customerRef = `/stripe_customers/${userId}`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error('No stripe customer found')
        }
        customer = snapshot.val()["customer_id"]
        const eventRef = `/events/${eventId}`
        return admin.database().ref(eventRef).once('value').then(snapshot => { 
            return snapshot.val() 
        })
    }).then(eventDict => {
        amount = eventDict["amount"] * 100 // amount needs to be in cents and is stored in dollars
        const idempotency_key = chargeId;
        const currency = 'USD'
        const capture = false
        const description = "Payment hold for event " + eventId
        let charge = {amount, currency, customer, capture, description};
        // TODO is this needed?
        // if (data.source != undefined) {
        //     charge.source = data.source
        // }
        console.log("Stripe 1.1: holdPayment amount " + amount + " customer " + customer + " charge " + JSON.stringify(charge))

        return stripe.charges.create(charge, {idempotency_key})
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.1: holdPayment success with response " + JSON.stringify(response))
        // const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        response["player_id"] = userId
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.update(response).then(result => {
            var type = "holdPaymentForEvent"
            return exports.createAction(type, userId, eventId, null)
        }).then(result => {
            return {"result": "success", "chargeId":chargeId, "status": response["status"], "captured": response["captured"]}
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("Stripe 1.1: holdPayment error " + JSON.stringify(error) + ' for chargeId ' + chargeId)
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        var params = {'status': 'error', 'error': error.message, 'amount': amount, 'customer': customer, 'player_id': userId}
        return ref.update(params).then(result => {
            params['result'] = 'error'
            return params
        })
    })
}

exports.capturePayment = function(req, res, exports) {
    const userId = req.body.userId
    const eventId = req.body.eventId
    const chargeId = req.body.chargeId
    const isAdmin = req.body.isAdmin

    // TODO: validate that the user is the organizer of the event
    console.log("Stripe 1.1: capturePayment chargeId " + chargeId + " eventId " + eventId)
    const eventRef = admin.database().ref(`/events/${eventId}`)
    return admin.database().ref(eventRef).once('value').then(snapshot => {
        if (snapshot.val() == undefined) {
            throw new Error("Could not find event to capture") // this should not happen
        }
        return snapshot.val()
    }).then(eventDict => {
        // BOBBY TODO move event request earlier
        if (eventDict["organizer"] == userId || eventDict["owner"] == userId || isAdmin == true) {
            var initiatedBy = "unknown"
            if (eventDict["organizer"] == userId) {
                initiatedBy = "organizer " + userId
            } else if (eventDict["owner"] == userId) {
                initiatedBy = "organizer " + userId
            } else if (isAdmin) {
                initiatedBy = "admin " + userId
            }
            console.log("Stripe 1.1: capturePayment initiated by " + initiatedBy)
            const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)    
            return admin.database().ref(chargeRef).once('value').then(snapshot => {
                return snapshot.val()
            })
        } else {
            throw new Error("You are not allowed to capture this payment")
        }
    }).then(charge => {
        if (charge["captured"] != false) {
            throw new Error("This payment cannot be captured because it has has already been completed")
        }
        const paymentId = charge["id"]
        if (charge["id"] == undefined) {
            throw new Error("Could not capture payment because no valid payment id was found")
        }
        return stripe.charges.capture(paymentId)
    }).then(response => {
        const status = response["status"]
        const captured = response["captured"]
        console.log("Stripe 1.1: capturePayment success with response " + JSON.stringify(response))
        // const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.update(response).then(result => {
            return res.status(200).json({"result": "success", "chargeId":chargeId, "status": status, "captured": captured})
        })
    }, error => {
        // catch errors
        console.log("CapturePayment error: " + JSON.stringify(error))
        const status = "captureFailed"
        const captured = false
        const params = {"status": status, "captured": captured, "error": error.message, 'created': exports.secondsSince1970()}
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.update(params).then(result => {
            throw error
        })
    }).catch( (err) => {
        console.log("Stripe v1.1 capturePayment: chargeId " + chargeId + " error: " + err)
        return res.status(500).json({"error": err.message})
    })
}

/*
 * returns {type:"stripeConnectedAccount", stripeUserId:} if stripeConnectedAccounts contains userId
 * returns {type:"none"} otherwise
 */
checkForStripeConnectForEvent = function(eventId) {
    var foundEvent = undefined
    var organizerId = undefined
    return admin.database().ref(`events/${eventId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("Event not found")
        }
        console.log("checkForStripeConnectForEvent: eventId " + eventId)
        return snapshot.val()
    }).then(event => {
        foundEvent = event
        organizerId = event.organizer
        console.log("checkForStripeConnectForEvent: organizerId " + organizerId)
        return admin.database().ref(`stripeConnectAccounts/${organizerId}`).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            return {'type': 'none', 'event': foundEvent}
        }
        const account = snapshot.val()
        console.log("checkForStripeConnectForEvent: stripeConnectAccount " + JSON.stringify(account))
        if (account.stripeUserId != undefined) {
            return {'type': 'stripeConnectAccount', 'connectId': organizerId, 'event': foundEvent}
        } else {
            return {'type': 'none', 'event': foundEvent}
        }
    })
}