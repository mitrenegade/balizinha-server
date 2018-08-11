/**
 * Allows user to join a game and create a payment hold
 * params: userId: String, eventId: String
 * result: { },  or error
 */
exports.holdPayment = function(req, res, stripe, exports, admin) {
    const userId = req.body.userId
    const eventId = req.body.eventId

    const chargeId = exports.createUniqueId()

    console.log("Stripe v1.1: holdPayment userId " + userId + " event " + eventId + " new charge " + chargeId)
    var customerDict = {}
    const customerRef = `/stripe_customers/${userId}`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        customerDict = customer
        const eventRef = `/events/${eventId}`
        return admin.database().ref(eventRef).once('value').then(snapshot => { 
            return snapshot.val() 
        })
    }).then(eventDict => {
        const customer = customerDict["customer_id"]
        const amount = eventDict["amount"] * 100 // amount needs to be in cents and is stored in dollars
        const idempotency_key = chargeId;
        const currency = 'USD'
        const capture = false
        const description = "Payment hold for event " + eventId
        let charge = {amount, currency, customer, capture, description};
        // TODO is this needed?
        // if (data.source != undefined) {
        //     charge.source = data.source
        // }
        console.log("Stripe 1.1: holdPayment amount " + amount + " customerId " + customer + " charge " + JSON.stringify(charge))

        return stripe.charges.create(charge, {idempotency_key})
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.1: holdPayment success with response " + JSON.stringify(response))
        // const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.set(response).then(result => {
            return res.status(200).json({"result": "success", "chargeId":chargeId, "status": response["status"], "captured": response["captured"]})
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("Stripe 1.1: holdPayment error " + JSON.stringify(error))
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return ref.child('error').set(error.message).then(result => {
            return res.status(500).json({"error": JSON.stringify(error)})
        })
    }).then(result => {
        var type = "holdPaymentForEvent"
        return exports.createAction(type, userId, eventId, null)
    })
}

exports.capturePayment = function(req, res, stripe, exports, admin) {
    const userId = req.body.userId
    const eventId = req.body.eventId
    const chargeId = req.body.chargeId

    // TODO: validate that the user is the organizer of the event
    console.log("Stripe 1.1: capturePayment chargeId " + chargeId + " eventId " + eventId)

    const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)    
    return admin.database().ref(chargeRef).once('value').then(snapshot => {
        return snapshot.val();
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
        const captured =response["captured"]
        console.log("Stripe 1.1: capturePayment success with response " + JSON.stringify(response))
        // const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.set(response).then(result => {
            return res.status(200).json({"result": "success", "chargeId":chargeId, "status": status, "captured": captured})
        })
    }).catch( (err) => {
        console.log("Stripe v1.1 capturePayment: chargeId " + chargeId + " error: " + err)
        return res.status(500).json({"error": err.message})
    })
}
