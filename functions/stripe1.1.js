/**
 * Allows user to join a game and create a payment hold
 * params: userId: String, eventId: String
 * result: { },  or error
 */
exports.submitPayment = function(req, res, stripe, exports, admin) {
    const userId = req.body.userId
    const eventId = req.body.eventId

    const chargeId = exports.createUniqueId()

    console.log("Stripe v1.1: submitPayment userId " + userId + " event " + eventId + " new charge " + chargeId)
    var customerDict = {}
    const customerRef = `/stripe_customers/${userId}`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        console.log("Stripe v1.1: customer " + JSON.stringify(snapshot.val()))
        return snapshot.val();
    }).then(customer => {
        customerDict = customer
        const eventRef = `/events/${eventId}`
        return admin.database().ref(eventRef).once('value').then(snapshot => { 
            console.log("Stripe v1.1: event " + JSON.stringify(snapshot.val()))
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
        console.log("Stripe 1.1: createStripeCharge amount " + amount + " customerId " + customer + " charge " + JSON.stringify(charge))

        return stripe.charges.create(charge, {idempotency_key})
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.1: createStripeCharge success with response " + JSON.stringify(response))
        // const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.set(response).then(result => {
            return res.status(200).json({"result": "success", "chargeId":chargeId, "status": response["status"], "captured": response["captured"]})
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("Stripe 1.1: createStripeCharge error " + JSON.stringify(error))
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return ref.child('error').set(error.message).then(result => {
            return res.status(500).json({"error": JSON.stringify(error)})
        })
    }).then(result => {
        var type = "holdPaymentForEvent"
        return exports.createAction(type, userId, eventId, null)
    })
}

