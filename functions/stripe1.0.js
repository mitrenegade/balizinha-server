const globals = require('./globals')

const stripeToken = globals.stripeToken
const stripe = require('stripe')(stripeToken)

const admin = require('firebase-admin');

// Stripe
const currency = 'USD';

// cloud functions are all defined in index.js but they call module functions
// https://stackoverflow.com/questions/43486278/how-do-i-structure-cloud-functions-for-firebase-to-deploy-multiple-functions-fro

exports.ephemeralKeys = function(req, res) {
    let stripe_version = req.body.api_version
    let customer_id = req.body.customer_id
    console.log('Stripe v1.0 ephemeralKeys with ' + stripe_version + ' and ' + customer_id)
    if (!stripe_version) {
        return res.status(400).end();
    }
    // This function assumes that some previous middleware has determined the
    // correct customerId for the session and saved it on the request object.
    stripe.ephemeralKeys.create(
        {customer: customer_id},
        {stripe_version: stripe_version}
    ).then((key) => {
        res.status(200).json(key);
    }).catch((err) => {
        res.status(500).end();
    });
}

exports.createStripeCustomer = function(email, uid) {
    console.log("Stripe 1.0: Creating stripeCustomer " + uid + " " + email)
    const ref = `/stripe_customers/${uid}/customer_id`
    return stripe.customers.create({
        email: email
    }, function(err, customer) {
        if (err != undefined) {
            console.log('CreateStripeCustomer v1.0' + ref + ' resulted in error ' + err)
            return err
        } else {
            console.log('CreateStripeCustomer v1.0 ' + ref + ' email ' + email + ' created with customer_id ' + customer.id)
            return admin.database().ref(ref).set(customer.id);
        }
    }).then(result => {
        console.log('createStripeCustomer returning the value')
        return admin.database().ref(ref).once('value')
    })
}

exports.validateStripeCustomer = function(req, res, exports, admin) {
    const userId = req.body.userId
    const email = req.body.email

    if (userId == undefined || userId == "") {
        return res.status(500).json({"error": "Could not validate Stripe customer: empty user id"})
    }
    if (email == undefined || email == "") {
        return res.status(500).json({"error": "Could not validate Stripe customer: empty email"})
    }

    var customerRef = `/stripe_customers/${userId}/customer_id`
    return admin.database().ref(customerRef).once('value')
    .then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        if (customer != undefined) {
            console.log("Stripe 1.0: ValidateStripeCustomer: userId " + userId + " found customer_id " + customer)
            return res.status(200).json({"customer_id" : customer})
        } else {
            console.log("Stripe 1.0: ValidateStripeCustomer: userId " + userId + " creating customer...")
            return exports.createStripeCustomer(email, userId)
            .then(result => {
                console.log("Stripe 1.0: ValidateStripeCustomer: userId " + userId + " created customer with result " + JSON.stringify(result))
                return res.status(200).json({"customer_id": result})
            })
        }
    })
}

exports.savePaymentInfo = function(req, res, admin) {
    const userId = req.body.userId
    const source = req.body.source
    const last4 = req.body.last4
    const label = req.body.label
    var customer_id = "unknown"
    console.log("Stripe 1.0: SavePaymentInfo: userId " + userId + " source " + source + " last4 " + last4 + " label " + label)
    var customerRef = `/stripe_customers/${userId}/customer_id`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        var userRef = `/stripe_customers/${userId}`
        var params = {"source": source, "last4": last4, "label": label}
        customer_id = customer
        return admin.database().ref(userRef).update(params)
    }).then(result => {
        return res.status(200).json({"customer_id": customer_id})
    }).catch((err) => {
        console.log("Probably no customer_id for userId. err " + JSON.stringify(err))
        return res.status(500).json({"error": err})
    })
}

// Charge the Stripe customer whenever an amount is written to the Realtime database
exports.createStripeCharge = function(snapshot, context, exports, admin) {
//function createStripeCharge(req, res, ref) {
    var eventId = context.params.eventId
    var chargeId = context.params.chargeId
    var data = snapshot.val()

    const userId = data["player_id"]
    console.log("Stripe 1.0: createStripeCharge: user " + userId + " event " + eventId + " charge id " + chargeId + " data " + JSON.stringify(data))
    // This onWrite will trigger whenever anything is written to the path, so
    // noop if the charge was deleted, errored out, or the Stripe API returned a result (id exists) 
    if (data == undefined || data.id || data.error) {
        if (data.id) {
            console.log("Stripe 1.0: createStripeCharge failed because data already exists with id " + data.id)
        } else if (data.error) {
            console.log("Stripe 1.0: createStripeCharge failed because data had error " + data.error)
        } else if (data == undefined) {
            console.log("Stripe 1.0: createStripeCharge failed because data was null")
        }
        return null
    }
    // Look up the Stripe customer id written in createStripeCustomer
    var customerRef = `/stripe_customers/${userId}`
    var eventRef = `/events/${eventId}`
    const amount = data.amount;
    var customer = ""
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customerDict => {
        // Create a charge using the pushId as the idempotency key, protecting against double charges 
        customer = customerDict["customer_id"]
        const idempotency_key = chargeId;
        const currency = 'USD'
        let charge = {amount, currency, customer};
        if (data.source != undefined) {
            charge.source = data.source
        }
        console.log("Stripe 1.0: createStripeCharge amount " + amount + " customerId " + customer + " charge " + JSON.stringify(charge))
        return stripe.charges.create(charge, {idempotency_key});
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("Stripe 1.0: createStripeCharge success with response " + JSON.stringify(response))
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return ref.update(response).then(result => {
            var type = globals.ActionType.payForEvent
            return exports.createAction(type, userId, eventId, null)
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("Stripe 1.0: createStripeCharge error " + JSON.stringify(error))
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        const params = {'status': 'error', 'error': error.message, 'amount': amount, 'customer': customer, 'player_id': userId, 'created': exports.secondsSince1970()}
        return ref.update(params)
    })
}

exports.refundCharge = function(req, res) {
    const chargeId = req.body.chargeId // charge Id from balizinha
    const eventId = req.body.eventId
    const organizerId = req.body.organizerId
    const amount = req.body.amount // can be null // in cents
    var type = ""
    var typeId = ""
    if (eventId != undefined) {
        type = "events"
        typeId = eventId
    } else if (organizerId != undefined) {
        type = "organizers"
        typeId = organizerId
    } else {
        res.status(500).json({"error": "Must include eventId or organizerId"})
        return
    }

    console.log("Stripe 1.0: refundCharge type " + type + " typeId " + typeId + " chargeId " + chargeId + " amount " + amount)
    var chargeRef = `/charges/${type}/${typeId}/${chargeId}`
    return admin.database().ref(chargeRef).once('value').then(snapshot => {
        return snapshot.val();
    }).then((charge) => {
        // refund charge
        var id = charge["id"]
        var chargedAmount = charge["amount"]
        var status = charge["status"] // just for debugging
        var customer = charge["customer"]
        var params = {"charge": id}
        if (amount != undefined) {
            params["amount"] = amount
        }
        console.log("Stripe 1.0: RefundCharge found charge with id " + id + " status " + status + " amount " + amount + " customer " + customer)
        return stripe.refunds.create(params)
    }).then((refund) => {
        // retrieve the charge to update it
        // refund should look like: {"id":"re_1C9DWEGxJEewqdf9n0zYcJHT","object":"refund","amount":100,"balance_transaction":"txn_1C9DWEGxJEewqdf9lhvIQLrj","charge":"ch_1C9DUlGxJEewqdf9MYZVyjgy","created":1521902334,"currency":"usd","metadata":{},"reason":null,"receipt_number":null,"status":"succeeded"}
        console.log("Stripe 1.0: refund result " + JSON.stringify(refund))
        var id = refund["charge"]
        return stripe.charges.retrieve(id)
    }, error => {
        console.log("Stripe 1.0: refund error: " + JSON.stringify(error))
        const status = "refundFailed"
        const refunded = false
        const params = {"status": status, "refunded": refunded, "error": error.message}
        const chargeRef = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return chargeRef.update(params).then(result => {
            throw error
        })
    }).then((updatedCharge) => {
        console.log("Stripe 1.0: RefundCharge updated charge " + JSON.stringify(updatedCharge))
        return admin.database().ref(chargeRef).update(updatedCharge).then((result) => {
            return res.status(200).json({"result": "success", "chargeId": chargeId, "status": updatedCharge["status"], "refunded": updatedCharge["refunded"]})
        })
    }).catch((error) => {
        console.log("Stripe 1.0: RefundCharge caught err " + JSON.stringify(error))
        res.status(500).json(error)
    })
}
