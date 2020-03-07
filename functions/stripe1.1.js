const globals = require('./globals')
const stripeConnect = require('./stripeConnect1.0')
const admin = require('firebase-admin');

const stripeToken = globals.stripeToken
const stripe = require('stripe')(stripeToken)
/**
 * Allows user to join a game and create a payment hold
 * params: userId: String, eventId: String
 * result: { result: "success", chargeId: String, status: "succeeded", captured: bool}
        or { result: "error", message: String }
 */
exports.makePayment = function(req, res, exports) {
    const userId = req.body.userId
    const eventId = req.body.eventId
    const chargeId = exports.createUniqueId()

    return checkForStripeConnectForEvent(eventId).then(result => {
        const isConnectedAccount = result.type == 'stripeConnectAccount'
        const foundEvent = result.event
        const amount = foundEvent.amount * 100
        console.log("Stripe 1.1: makePayment: checkForStripeConnect result " + JSON.stringify(result) + " with stripeConnectAccount? " + isConnectedAccount)
        if (isConnectedAccount) {
            const connectId = result.connectId
            return makeConnectCharge(connectId, userId, eventId, amount, chargeId, exports)
        } else {
            return makePaymentForPlatformCharge(userId, eventId, amount, chargeId, exports)
        }
    }).then(result => {
        console.log("Stripe 1.1: makePayment: result " + JSON.stringify(result))
        if (result["result"] == 'error') {
            return res.status(500).json(result)
        } else {
            return res.status(200).json(result)
        }
    })
    .catch(err => {
        err.error = err.message
        if (err.message == "If you specify a customer when sharing a source, the source must be attached to the customer beforehand.") {
            // this happens if a user has a stripe card instead of a source associated with a costomer
            err.error = "We've upgraded our payment system. Please update your payment method and try again."
        }
        console.log("Stripe 1.1: makePayment: caught error " + JSON.stringify(err))
        return res.status(500).json(err)
    })
}

makeConnectCharge = function(connectId, userId, eventId, amount, chargeId, exports) {
    console.log("Stripe 1.1: makeConnectCharge: This is a Stripe Connect user's event " + eventId + " with stripeUserId " + connectId + " amount " + amount + " userId " + userId + " chargeId " + chargeId)
    var chargeResult = {'result': ''}
    return stripeConnect.doStripeConnectCharge(amount, eventId, connectId, userId, chargeId).then(response => {
        chargeResult = {"result": "success", 
                        "chargeId":chargeId, 
                        "status": response["status"], 
                        "captured": response["captured"]}
        var type = globals.ActionType.stripeConnectChargeForEvent
        return exports.createAction(type, userId, eventId, null, "made a payment")
    }).then(actionId => {
        // createAction returns a single actionId which is not the result we want
        return chargeResult
    })
}


// makes a charge on Panna's platform
makePaymentForPlatformCharge = function(userId, eventId, amount, chargeId, exports) {
    const capture = true // set to false if hold payments should be used instead of direct charges on the platform
    console.log("Stripe v1.1: makePaymentForPlatformCharge userId " + userId + " event " + eventId + " new charge " + chargeId)

    // check old and new stripe customers
    const customerRef = `/stripeCustomers/${userId}`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            return admin.database().ref(`/stripe_customers/${userId}`).once('value').then(snapshot => {
                if (!snapshot.exists()) {
                    throw new Error("No Stripe customer found")
                } else {
                    return snapshot
                }
            })
        } else {
            return snapshot
        }
    }).then(snapshot => {
        const idempotency_key = chargeId;
        const currency = 'USD'
        var description = "Payment hold for event " + eventId
        if (capture == true) {
            description = "Platform charge event " + eventId
        }
        const customer = snapshot.val().customer_id
        let charge = {amount, currency, customer, capture, description};
        // TODO is this needed?
        // if (data.source != undefined) {
        //     charge.source = data.source
        // }
        console.log("Stripe 1.1: makePaymentForPlatformCharge amount " + amount + " customer " + customer + " charge " + JSON.stringify(charge))

        return stripe.charges.create(charge, {idempotency_key})
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.1: makePaymentForPlatformCharge success with response " + JSON.stringify(response))
        // const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        response["player_id"] = userId
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.update(response).then(result => {
            var type = globals.ActionType.holdPaymentForEvent
            if (capture == true) {
                type = globals.ActionType.payForEvent
            }
            return exports.createAction(type, userId, eventId, null)
        }).then(result => {
            return {"result": "success", "chargeId":chargeId, "status": response["status"], "captured": response["captured"]}
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("Stripe 1.1: makePaymentForPlatformCharge error " + JSON.stringify(error) + ' for chargeId ' + chargeId)
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        var params = {'status': 'error', 'error': error.message, 'amount': amount, 'customer': customer, 'player_id': userId}
        return ref.update(params).then(result => {
            params['result'] = 'error'
            return params
        })
    })
}

// deprecated (not used)
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
        if (eventDict["organizer"] == userId || eventDict["owner"] == userId || eventDict["ownerId"] == userId || isAdmin == true) {
            var initiatedBy = "unknown"
            if (eventDict["organizer"] == userId) {
                initiatedBy = "organizer " + userId
            } else if (eventDict["owner"] == userId || eventDict["ownerId"] == userId) {
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
    var ownerId = undefined
    return admin.database().ref(`events/${eventId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("Event not found")
        }
        console.log("checkForStripeConnectForEvent: eventId " + eventId)
        return snapshot.val()
    }).then(event => {
        foundEvent = event
        ownerId = event.ownerId
        if (ownerId == undefined) {
            ownerId = event.owner // old
        }
        console.log("checkForStripeConnectForEvent: ownerId " + ownerId)
        return admin.database().ref(`stripeConnectAccounts/${ownerId}`).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            return {'type': 'none', 'event': foundEvent}
        }
        const account = snapshot.val()
        console.log("checkForStripeConnectForEvent: stripeConnectAccount " + JSON.stringify(account))
        if (account.stripeUserId != undefined) {
            return {'type': 'stripeConnectAccount', 'connectId': ownerId, 'event': foundEvent}
        } else {
            return {'type': 'none', 'event': foundEvent}
        }
    })
}