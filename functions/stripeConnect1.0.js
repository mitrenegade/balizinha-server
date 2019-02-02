const functions = require('firebase-functions');
const admin = require('firebase-admin');
const request = require('request')
const globals = require('./globals')

const stripeToken = globals.stripeToken
const stripe = require('stripe')(stripeToken)

/*** Stripe connect ***/
// https://stackoverflow.com/questions/52493606/stripe-connect-firebase-functions
exports.stripeConnectRedirectHandler = function(req, res, exports) {
    // the url will look like: 
    // http://us-central1-balizinha-dev.cloudfunctions.net/stripeConnectRedirectHandler?scope=read_write&code={AUTHORIZATION_CODE}
    console.log("StripeConnectRedirectHandler with query: " + JSON.stringify(req.query))
    var code = req.query.code
    var userId = req.query.state

    // request access token
    let url = "https://connect.stripe.com/oauth/token"
    request.post(url,
        { 
            form: { 
                "client_secret": stripeToken,
                "code": code,
                "grant_type": "authorization_code"
            },
        },
        function (e, r, body) {
            console.log("StripeConnectRedirectHandler: body " + JSON.stringify(body))
            let json = JSON.parse(body)
            let accessToken = json.access_token
            let refreshToken = json.refresh_token
            let stripeUserId = json.stripe_user_id
            let publishableKey = json.stripe_publishable_key

            return storeStripeConnectTokens(userId, stripeUserId, accessToken, refreshToken, publishableKey).then(result => {
                console.log("StripeConnectRedirectHandler: stored tokens with result " + JSON.stringify(result))
                let url = "panna://stripeConnect/" + userId
                return res.redirect(url)
            })
    });
}

storeStripeConnectTokens = function(userId, stripeUserId, accessToken, refreshToken, publishableKey) {
    const ref = `/stripeConnectAccounts/${userId}`
    const params = {"accessToken": accessToken, 
                    "refreshToken": refreshToken,
                    "stripeUserId": stripeUserId,
                    "publishableKey": publishableKey}
    console.log("StoreStripeConnectTokens: ref " + ref + " tokens " + JSON.stringify(params))
    return admin.database().ref(ref).set(params)
}

exports.getConnectAccountInfo = function(req, res, exports) {
	var accountId = req.query.accountId
	if (accountId == undefined) {
		console.log("getConnectAccountInfo: No Stripe account provided")
		return res.status(500).json({"error": "No Stripe account provided"})
	}

	return stripe.accounts.retrieve(accountId,
		function(err, account) {
		// asynchronously called
			if (err != undefined) {
				console.log("getConnectAccountInfo: received error while retrieving accounts: " + JSON.stringify(err))
				return res.status(500).json({"error": "Received error while retrieving accounts", "info": err})
			} else {
				console.log("getConnectAccountInfo: Retrieved accounts for " + accountId + ": " + JSON.stringify(account))
				return res.status(200).json({"account": account})
			}
		}
	);
}

/*
 * Params:
 * amount: Int, cents
 * orgId: String
 * eventId: String
 * chargeId: String, client-generated
 * source: payment token from stripe
 */
exports.createStripeConnectCharge = function(req, res, exports) {
    // Create a charge using the pushId as the idempotency key, protecting against double charges 
    const amount = req.body.amount;
    const eventId = req.body.eventId
    const connectId = req.body.connectId // index into stripeConnectAccount
    const customerId = req.body.customer_id // index into stripeCustomer
    var chargeId = req.body.chargeId
    if (chargeId == undefined) {
        chargeId = exports.createUniqueId()
    }

    const idempotency_key = chargeId

    console.log("CreateStripeConnectCharge amount " + amount + " connectId " + connectId + " customerId " + customerId + " event " + eventId)
    return exports.doStripeConnectCharge(amount, eventId, connectId, customerId, chargeId).then(result => {
        return res.status(200).json({"success": true, "chargeId": chargeId, "result": response})
    }).catch((error) => {
        console.log("CreateStripeConnectCharge caught error: " + error) //JSON.stringify(error))
        return res.status(500).json({"error": error})
    })
}

exports.doStripeConnectCharge = function(amount, eventId, connectId, player_id, chargeId) {
    // TODO: use two promises to pull stripeConnectAccount and stripeCustomer info
    const currency = 'USD'
    console.log("doStripeConnectCharge: calling createStripeConnectChargeToken with connectId " + connectId + " player_id " + player_id)
    return createStripeConnectChargeToken(connectId, player_id).then(result => {
        var token = result.token
        var stripe_account = result.stripe_account
        var source = token.id
        var customerId = result.customerId // for logging only
        const charge = {
            amount, 
            currency,
            source
            //application_fee
        }
        const headers = {
//            idempotency_key, 
            stripe_account
        }
        console.log("CreateStripeConnectCharge: creating charge for stripe connect: charge: " + JSON.stringify(charge), " headers: " + JSON.stringify(headers))
        return stripe.charges.create(charge, headers)
        .then(response => {
            // If the result is successful, write it back to the database
            console.log("CreateStripeConnectCharge success with response " + JSON.stringify(response))
            response.connectId = connectId
            response.player_id = player_id
            response.customer = customerId // old holdPayment uses customer
            response.stripeUserId = stripe_account
            const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
            // TODO: also add connectId to it
            return ref.update(response)
        }, error => {
            console.log("CreateStripeConnectCharge createCharge error: " + error)
            params = {'connectId': connectId, 'player_id': player_id, 'customer': customerId, 'stripeUserId': stripe_account, 'error': error.message}
            return admin.database().ref(`/charges/events/${eventId}/${chargeId}`).update(params).then(()=> {
                throw error
            })
        })
    })
}

// https://stripe.com/docs/connect/shared-customers
// https://stripe.com/docs/sources/connect#shared-card-sources
createStripeConnectChargeToken = function(connectId, player_id) {
    return admin.database().ref(`/stripeConnectAccounts/${connectId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("No Stripe account found for organization " + connectId)
        }
        var stripe_account = snapshot.val().stripeUserId
        if (stripe_account == undefined) {
            throw new Error("No Stripe account associated with " + connectId + ". Dict: " + JSON.stringify(snapshot.val()))
        }
        var customer = ""
        return admin.database().ref(`/stripeCustomers/${player_id}`).once('value').then(snapshot => {
            if (!snapshot.exists()) {
                throw new Error("No customer account found for " + player_id)
            }
            customer = snapshot.val().customer_id
            var original_source = snapshot.val().source
            if (customer == undefined) {
                throw new Error("No customer account associated with " + customer)
            }

            console.log("createStripeConnectChargeToken: Customer " + customer + " source " + original_source + " stripe_account " + stripe_account)
            const usage = 'single_use'
            // create a one time shared source
            return stripe.sources.create({
                customer,
                original_source,
                usage // TODO: make this reusable, and add it to a customer/stripe account
            }, {
                stripe_account
            })
        }).then(token => {
            const result = {'token': token, 'stripe_account': stripe_account, 'customerId': customer}
            console.log("createStripeConnectChargeToken: success with result " + JSON.stringify(result))
            return result
        })
    })
}

////////// Migration from stripe1.0 customer and payment creation to use stripeCustomer
exports.createStripeCustomer = function(email, uid) {
    console.log("StripeConnect 1.0: Creating stripeCustomer " + uid + " " + email)
    const ref = `/stripeCustomers/${uid}/customer_id`
    return stripe.customers.create({
        email: email
    }, function(err, customer) {
        if (err != undefined) {
            console.log('StripeConnect: CreateStripeCustomer v1.0' + ref + ' resulted in error ' + err)
            return err
        } else {
            console.log('StripeConnect: CreateStripeCustomer v1.0 ' + ref + ' email ' + email + ' created with customer_id ' + customer.id)
            return admin.database().ref(ref).set(customer.id);
        }
    }).then(result => {
        console.log('StripeConnect: createStripeCustomer returning the value')
        return admin.database().ref(ref).once('value')
    })
}

exports.validateStripeCustomer = function(req, res) {
    const userId = req.body.userId
    const email = req.body.email

    if (userId == undefined || userId == "") {
        return res.status(500).json({"error": "Could not validate Stripe customer: empty user id"})
    }
    if (email == undefined || email == "") {
        return res.status(500).json({"error": "Could not validate Stripe customer: empty email"})
    }

    var customerRef = `/stripeCustomers/${userId}/customer_id`
    return admin.database().ref(customerRef).once('value')
    .then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        if (customer != undefined) {
            console.log("StripeConnect 1.0: ValidateStripeCustomer: userId " + userId + " found customer_id " + customer)
            return res.status(200).json({"customer_id" : customer})
        } else {
            console.log("StripeConnect 1.0: ValidateStripeCustomer: userId " + userId + " creating customer...")
            return exports.createStripeCustomer(email, userId)
            .then(result => {
                console.log("StripeConnect 1.0: ValidateStripeCustomer: userId " + userId + " created customer with result " + JSON.stringify(result))
                return res.status(200).json({"customer_id": result})
            })
        }
    })
}

// saves a card as a source under stripeCustomers
exports.savePaymentInfo = function(req, res) {
    const userId = req.body.userId
    const source = req.body.source
    const last4 = req.body.last4
    const label = req.body.label
    var customer_id = "unknown"
    console.log("StripeConnect 1.0: SavePaymentInfo: userId " + userId + " source " + source + " last4 " + last4 + " label " + label)
    return migrateStripeCustomer(userId).then(customer => {
        var userRef = `/stripeCustomers/${userId}`
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

/* for migration from stripe_customers to stripeCustomers; makes sure stripeCustomer exists, then returns customer_id
 * params: userId
 * rerturn value is customer_id or throw an error if user didn't exist under stripe_customers
 */
migrateStripeCustomer = function(userId) {
    var newCustomerRef = `/stripeCustomers/${userId}`
    return admin.database().ref(newCustomerRef).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            var oldCustomerRef = `/stripe_customers/${userId}`
            return admin.database().ref(oldCustomerRef).once('value').then(snapshot => {
                if (!snapshot.exists()) {
                    console.log("StripeConnect 1.0: migrateStripeCustomer " + userId + " could not be found!")
                    throw new Error("Invalid customer")
                }
                return admin.database().ref(newCustomerRef).set(snapshot.val()).then(result => {
                    console.log("StripeConnect 1.0: migrateStripeCustomer " + userId + " succeeded with value " + JSON.stringify(snapshot.val()))
                    return snapshot.val().customer_id
                })
            })
        } else {
            console.log("StripeConnect 1.0: migrateStripeCustomer " + userId + " already exists with value " + JSON.stringify(snapshot.val()))
            return snapshot.val().customer_id
        }
    })
}

