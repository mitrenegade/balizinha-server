const functions = require('firebase-functions');
const admin = require('firebase-admin');
const logging = require('@google-cloud/logging')();
const app = require('express')
const moment = require('moment')
const league1_0 = require('./league1.0')
const event1_0 = require('./event1.0')
const actionModule = require('./action')
const push1_0 = require('./push1.0')

admin.initializeApp(functions.config().firebase);

// TO TOGGLE BETWEEN DEV AND PROD: change this to .dev or .prod for functions:config variables to be correct
const config = functions.config().dev
const stripe = require('stripe')(config.stripe.token)
// 1.4 leagues
// 1.5 event.js, league.js, action.js, push.js
const API_VERSION = 1.0
const BUILD_VERSION = 105 // for internal tracking

const DEFAULT_LEAGUE_ID_DEV = "1525785307-821232"
const DEFAULT_LEAGUE_ID_PROD = "1525175000-268371"
const DEFAULT_LEAGUE = DEFAULT_LEAGUE_ID_DEV // change this when switching to prod

exports.onCreateUser = functions.auth.user().onCreate(user => {
    console.log("onCreateUser v1.4 complete with user " + JSON.stringify(user))
    const email = user.email;
    const userId = user.uid;

    if (email == undefined) {
        console.log('anonymous customer ' + userId + ' created, not creating stripe customer. has provider data? ' + user.providerData)
        return user
    }

    return exports.doEmailSignup(userId, email)
});

exports.doEmailSignup = function(userId, email) {
    console.log("onCreateUser calling createPlayer with uid " + userId)
    return exports.createPlayer(userId).then(function (result) {
        console.log("onCreateUser createPlayer success with result " + result)
        return exports.createStripeCustomer(email, userId)
    })
}

// TODO tactually implement this in client
exports.onEmailSignupV1_5 = functions.https.onRequest((req, res) => {
    // in v1_5, when a player is created, their email is added to the anonymous account already created.
    // this causes onCreateUser to not be triggere a second time, thus createPlayer and createStripeCustomer are not called
    // the client accessing v1_4 must call onEmailSignupV1_4 to trigger player and customer creation in order to continue signup
    const userId = req.body.userId
    const email = req.body.email
    console.log("onEmailSignup v1.5: client call to create email user " + userId + " with email " + email)
    exports.doEmailSignup(userId, email)
})

exports.createPlayer = function(userId) {
    var ref = `/players/${userId}`
    console.log("Creating player for user " + userId)
    var params = {"uid": userId}
    params["createdAt"] = exports.secondsSince1970()
    return admin.database().ref(ref).update(params)
}

// event creation/change
exports.onPlayerCreate = functions.database.ref('/players/{userId}').onCreate((snapshot, context) => {
    console.log("onPlayerCreate triggered with snapshot " + JSON.stringify(snapshot) + " context " + JSON.stringify(context))
    var playerId = context.params.userId
    var email = snapshot.email // snapshot only contains email

    const isJoin = true
    return exports.doJoinLeaveLeague(admin, playerId, DEFAULT_LEAGUE, isJoin)
})

exports.onPlayerChange = functions.database.ref('/players/{userId}').onWrite((snapshot, context) => {
    console.log("onPlayerChange triggered with snapshot " + JSON.stringify(snapshot) + " context " + JSON.stringify(context))
    var playerId = context.params.userId
    var data = snapshot.after.val()

    // update city
    if (data["city"] != undefined) {
        var city = data["city"].toLowerCase()
        var ref = `/cityPlayers/` + city
        console.log("Creating cityPlayers for city " + city + " and player " + playerId)
        var params = {[playerId]: true}
        return admin.database().ref(ref).update(params)
    }

    if (data["promotionId"] != undefined) {
        var promo = data["promotionId"].toLowerCase()
        var ref = `/promoPlayers/` + promo
        console.log("Creating promoPlayers for promo " + promo + " and player " + playerId)
        var params = {[playerId]: true}
        return admin.database().ref(ref).update(params)
    }

    return data
})

exports.createStripeCustomer = function(email, uid) {
    console.log("creating stripeCustomer " + uid + " " + email)
    ref = `/stripe_customers/${uid}/customer_id`
    return stripe.customers.create({
        email: email
    }, function(err, customer) {
        if (err != undefined) {
            console.log('createStripeCustomer ' + ref + ' resulted in error ' + err)
            return err
        } else {
            console.log('createStripeCustomer ' + ref + ' email ' + email + ' created with customer_id ' + customer.id)
            return admin.database().ref(ref).set(customer.id);
        }
    }).then(result => {
        console.log('createStripeCustomer returning the value')
        return admin.database().ref(ref).once('value')
    })
};

exports.validateStripeCustomer = functions.https.onRequest( (req, res) => {
    const userId = req.body.userId
    const email = req.body.email

    if (userId == undefined || userId == "") {
        res.status(500).json({"error": "Could not validate Stripe customer: empty user id"})
        return
    }
    if (email == undefined || email == "") {
        res.status(500).json({"error": "Could not validate Stripe customer: empty email"})
        return
    }
    var customerRef = `/stripe_customers/${userId}/customer_id`
    return admin.database().ref(customerRef).once('value')
    .then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        if (customer != undefined) {
            console.log("ValidateStripeCustomer: userId " + userId + " found customer_id " + customer)
            res.status(200).json({"customer_id" : customer})
        } else {
            console.log("ValidateStripeCustomer: userId " + userId + " creating customer...")
            return exports.createStripeCustomer(email, userId)
        }
    }).then(result => {
        console.log("ValidateStripeCustomer: userId " + userId + " created customer with result " + JSON.stringify(result))
        res.status(200).json({"customer_id": result})
    })
})

exports.savePaymentInfo = functions.https.onRequest( (req, res) => {
    const userId = req.body.userId
    const source = req.body.source
    const last4 = req.body.last4
    const label = req.body.label
    var customer_id = "unknown"
    console.log("SavePaymentInfo: userId " + userId + " source " + source + " last4 " + last4 + " label " + label)
    var customerRef = `/stripe_customers/${userId}/customer_id`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        var userRef = `/stripe_customers/${userId}`
        var params = {"source": source, "last4": last4, "label": label}
        customer_id = customer
        return admin.database().ref(userRef).update(params)
    }).then(result => {
        res.status(200).json({"customer_id": customer_id})
    }).catch((err) => {
        console.log("Probably no customer_id for userId. err " + JSON.stringify(err))
        res.status(500).json({"error": err})
    })
})


exports.ephemeralKeys = functions.https.onRequest( (req, res) => {
    console.log('Called ephemeral keys with ' + req.body.api_version + ' and ' + req.body.customer_id)
    const stripe_version = req.body.api_version;
    if (!stripe_version) {
        res.status(400).end();
        return;
    }
    // This function assumes that some previous middleware has determined the
    // correct customerId for the session and saved it on the request object.
    stripe.ephemeralKeys.create(
        {customer: req.body.customer_id},
        {stripe_version: stripe_version}
    ).then((key) => {
        res.status(200).json(key);
    }).catch((err) => {
        res.status(500).end();
    });
});

// Charge the Stripe customer whenever an amount is written to the Realtime database
exports.createStripeChargeV1_4 = functions.database.ref(`/charges/events/{eventId}/{chargeId}`).onWrite((snapshot, context) => {
//function createStripeCharge(req, res, ref) {
    var eventId = context.params.eventId
    var chargeId = context.params.chargeId
    var data = snapshot.after.val()
    var old = snapshot.before

    console.log("createStripeCharge v1.4: event " + eventId + " charge id " + chargeId + " data " + JSON.stringify(data))
    const userId = data.player_id
    // This onWrite will trigger whenever anything is written to the path, so
    // noop if the charge was deleted, errored out, or the Stripe API returned a result (id exists) 
    if (data == undefined || data.id || data.error) {
        if (data.id) {
            console.log("createStripeCharge v1.4: failed because data already exists with id " + data.id)
        } else if (data.error) {
            console.log("createStripeCharge v1.4: failed because data had error " + data.error)
        } else if (data == undefined) {
            console.log("createStripeCharge v1.4: failed because data was null")
        }
        return null
    }
    // Look up the Stripe customer id written in createStripeCustomer
    var customerRef = `/stripe_customers/${userId}`
    return admin.database().ref(customerRef).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customerDict => {
        // Create a charge using the pushId as the idempotency key, protecting against double charges 
        const customer = customerDict["customer_id"]
        const amount = data.amount;
        const idempotency_key = chargeId;
        const currency = 'USD'
        let charge = {amount, currency, customer};
        if (data.source != undefined) {
            charge.source = data.source
        }
        console.log("createStripeCharge v1.4: amount " + amount + " customerId " + customer + " charge " + JSON.stringify(charge))
        return stripe.charges.create(charge, {idempotency_key});
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("createStripeCharge v1.4: success with response " + JSON.stringify(response))
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return ref.update(response).then(result => {
            var type = "payForEvent"
            return exports.createAction(type, userId, eventId, null)
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("createStripeCharge v1.4: error " + JSON.stringify(error))
        const ref = admin.database().ref(`/charges/events/${eventId}/${chargeId}`)
        return ref.child('error').set(error.message)
    })
});

exports.refundCharge = functions.https.onRequest( (req, res) => {
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

    console.log("refundCharge: type " + type + " typeId " + typeId + " chargeId " + chargeId + " amount " + amount)
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
        console.log("RefundCharge: found charge with id " + id + " status " + status + " amount " + amount + " customer " + customer)
        return stripe.refunds.create(params)
    }).then((refund) => {
        // retrieve the charge to update it
        // refund should look like: {"id":"re_1C9DWEGxJEewqdf9n0zYcJHT","object":"refund","amount":100,"balance_transaction":"txn_1C9DWEGxJEewqdf9lhvIQLrj","charge":"ch_1C9DUlGxJEewqdf9MYZVyjgy","created":1521902334,"currency":"usd","metadata":{},"reason":null,"receipt_number":null,"status":"succeeded"}
        console.log("Stripe: refund result " + JSON.stringify(refund))
        var id = refund["charge"]
        return stripe.charges.retrieve(id)
    }).then((updatedCharge) => {
        console.log("RefundCharge: updated charge " + JSON.stringify(updatedCharge))
        return admin.database().ref(chargeRef).update(updatedCharge)
    }).then((result) => {
        res.status(200).json(result) // update does not return the charge object so result is empty
    }).catch((error) => {
        console.log("RefundCharge: caught err " + JSON.stringify(error))
        res.status(500).json(error)
    })
})

exports.createStripeSubscription = functions.database.ref(`/charges/organizers/{organizerId}/{chargeId}`).onWrite((snapshot, context) => {
//function createStripeCharge(req, res, ref) {
    var organizerId = context.params.organizerId
    var chargeId = context.params.chargeId
    var val = snapshot.after.val()

    var isTrial = val["isTrial"]
    if (!isTrial) {
        isTrial = false
    }
    const trialMonths = 1
    console.log("createStripeSubscription for organizer " + organizerId + " charge id " + chargeId + " isTrial " + isTrial)
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
        console.log("createStripeSubscription customer " + customer + " trialEnd " + endDate + " plan " + plan)

        return stripe.subscriptions.create(subscription);
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("createStripeSubscription success with response " + response)
        const ref = admin.database().ref(`/charges/organizers/${organizerId}/${chargeId}`)
        return ref.update(response)
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        const trialEnd = moment().add(trialMonths, 'months')
        const endDate = Math.floor(trialEnd.toDate().getTime()/1000) // to unix time
        console.log("createStripeSubscription error " + error.message + " trial end " + endDate)
        const ref = admin.database().ref(`/charges/organizers/${organizerId}/${chargeId}`)
        return ref.update({"error": error.message, "status": "error", "deadline": endDate})
    });
});

// cron job
// exports.daily_job =
//   functions.pubsub.topic('daily-tick').onPublish((event) => {
//     console.log("This job is run every day! " + Date.now())
//   }
// )

// // a job set once in the past so that a cron job with a manual trigger can be used from google app engine's tasks
// exports.testJob = functions.pubsub.topic('on-demand-tick').onPublish((event) => {
//     var testToken = "eQuL09AtiCQ:APA91bHc5Yr4TQAOS8h6Sph1tCwIczrkWVf7u279xFxVpjUHaYksDwGTUUcnRk5jcTBFlWoLBs2AW9jAo8zJAdXyLD8kRqrtVjQWGSRBaOmJuN32SN-EE4-BqAp-IWDiB8O3otORC4wt"
//     var msg = "test worked, sending test push to " + testToken
//     console.log(msg)
//     exports.sendPush(testToken, msg)
// })

exports.secondsSince1970 = function() {
    var secondsSince1970 = new Date().getTime() / 1000
    return Math.floor(secondsSince1970)
}

exports.createUniqueId = function() {
    var secondsSince1970 = exports.secondsSince1970()
    var randomId = Math.floor(Math.random() * 899999 + 100000)
    return `${secondsSince1970}-${randomId}`
}

exports.getUniqueId = functions.https.onRequest( (req, res) => {
    var uniqueId = exports.createUniqueId()
    console.log('Called getUniqueId with result ' + uniqueId)
    res.status(200).json({"id": uniqueId})
})

// TEST calling cloud function from client
exports.sampleCloudFunction = functions.https.onRequest((req, res) => {
    const uid = req.query.uid
    const email = req.query.email

    // call this could function in the browser using this url:
    // https://us-central1-balizinha-dev.cloudfunctions.net/sampleCloudFunction?uid=123&email=456

    // the return must be a promise
    console.log("SampleCloudFunction called with parameters: uid " + uid + " email " + email)
    var ref = `/logs/SampleCloudFunction/${uid}`
    console.log("Sample cloud function logging with id " + uid + " email " + email)
    var params = {}
    params["email"] = email
    return admin.database().ref(ref).set(params).then(function (result) {
        console.log("Sample cloud function result " + result)
        return 1
    }).then(function(number) {
        console.log("Sample cloud function did something else that returned " + number)
        return
    })

    // chain existing functions together:
    // return exports.createPlayer(uid).then(function (result) {
    //     console.log("test cloud function createPlayer success")
    //     return exports.createStripeCustomer(email, uid)
    // })

})

// LEAGUE //////////////////////////////////////////////////////////////////////////////////
// Pass database to child functions so they have access to it

// http functions
exports.createLeague = functions.https.onRequest((req, res) => {
    return league1_0.createLeague(req, res, exports, admin);
});

/**
 * params: userId: String, leagueId: String, isJoin: boolean
 * result: { result: "success", userId: String, leagueId: String, status: String },  or error
 */
exports.joinLeaveLeague = functions.https.onRequest((req, res) => {
    let api = req.body.apiVersion
    // if (api == "1.6") {
    // }
    return league1_0.joinLeaveLeague(req, res, exports, admin)
});

/**
 * params: userId: String, leagueId: String, isJoin: boolean
 * result: { result: "success", userId: String, leagueId: String, status: String },  or error
 * DEPRECATED 1.6
 */
exports.joinLeaveLeague = functions.https.onRequest((req, res) => {
    return league1_0.joinLeaveLeague(req, res, exports, admin)
});

/**
 * params: leagueId: String
 * result: [ {playerId: status} ] status = member, organizer, owner
 */
 exports.getPlayersForLeague = functions.https.onRequest((req, res) => {
    return league1_0.getPlayersForLeague(req, res, exports, admin)
});

/**
 * params: userId: String
 * result: [ {leagueId: status} ] status = member, organizer, owner
 */
exports.getLeaguesForPlayer = functions.https.onRequest((req, res) => {
    return league1_0.getLeaguesForPlayer(req, res, exports, admin)
});

/**
 * params: userId: String, leagueId: String, status: String = [member, organizer, owner, none]
 * result: success or error
 * This is used by owners and admin app to update membership status, including organizer and ownership
 */
exports.changeLeaguePlayerStatus = functions.https.onRequest((req, res) => {
    let api = req.body.apiVersion
    // if (api == "1.6") {
    //     return league1_0.changeLeaguePlayerStatus(req, res, exports, admin)
    // }
    return league1_0.changeLeaguePlayerStatus(req, res, exports, admin)
})

/**
 * params: leagueId: String
 * result: [ { event } ]
 */
exports.getEventsForLeague = functions.https.onRequest((req, res) => {
    return league1_0.getEventsForLeague(req, res, exports, admin)
});

// helper functions
exports.doJoinLeaveLeague = function(admin, userId, leagueId, isJoin) {
    return league1_0.doJoinLeaveLeague(admin, userId, leagueId, isJoin)
}

exports.doUpdatePlayerStatus = function(admin, userId, leagueId, status) {
    return league1_0.doUpdatePlayerStatus(admin, userId, leagueId, status)
}

// EVENT //////////////////////////////////////////////////////////////////////////////////
/**
 * params: 
 ** required: userId, city, place: String
 **           startTime, endTime: Int (seconds from 1970)
 ** optional: league, name, type, state, info: String
 **           maxPlayers: Int
 **           paymentRequired: Bool
 **           amount, lat, lon: Double
 * result: [ { eventId: String } ]
 */
exports.createEvent = functions.https.onRequest((req, res) => {
    let api = req.body.apiVersion
    // if (api == "1.6") {
    //     // TODO
    // }
    return event1_0.createEvent(req, res, exports, admin)
})

/**
 * params: userId: String, eventId: String, join: Bool
 * result: [ { eventId: String } ]
 */

exports.joinOrLeaveEvent = functions.https.onRequest((req, res) => {
    // let api = req.body.apiVersion
    // if (api == "1.6") {
    //     // TODO
    // }
    return event1_0.joinOrLeaveEvent(req, res, exports, admin)
})

// helpers
exports.doJoinOrLeaveEvent = function(userId, eventId, join, admin) {
    return event1_0.doJoinOrLeaveEvent(userId, eventId, join, admin)
}

// database changes
exports.onEventChange = functions.database.ref('/events/{eventId}').onWrite((snapshot, context) => {
    return event1_0.onEventChange(snapshot, context, exports, admin)
})

exports.onUserJoinOrLeaveEvent = functions.database.ref('/eventUsers/{eventId}/{userId}').onWrite((snapshot, context) => {
    return event1_0.onUserJoinOrLeaveEvent(snapshot, context, exports, admin)
})

exports.onEventDelete = functions.database.ref('/events/{eventId}').onDelete((snapshot, context) => {
    return event1_0.onEventDelete(snapshot, context, exports, admin)
})

// helpers - must be defined here in order to use in module
exports.pushForCreateEvent = function(eventId, name, place) {
    return push1_0.pushForCreateEvent(eventId, name, place, exports, admin)
}

exports.pushForJoinEvent = function(eventId, name, join) {
    return push1_0.pushForJoinEvent(eventId, name, join, exports, admin)
}

// ACTION //////////////////////////////////////////////////////////////////////////////////
exports.createAction = function(type, userId, eventId, message) {
    return actionModule.createAction(type, userId, eventId, message, exports, admin)
}

exports.onActionChange = functions.database.ref('/actions/{actionId}').onWrite((snapshot, context) => {
    return actionModule.onActionChange(snapshot, context, exports, admin)
})

exports.pushForChatAction = function(actionId, eventId, userId, data) {
    return actionModule.pushForChatAction(actionId, eventId, userId, data, exports, admin)
}

// PUSH //////////////////////////////////////////////////////////////////////////////////

// database changes
exports.subscribeToOrganizerPush = functions.database.ref(`/organizers/{organizerId}`).onWrite((snapshot, context) => {
    return push1_0.subscribeToOrganizerPushV1_5(snapshot, context, exports, admin)
})

// helper functions
exports.createOrganizerTopicForNewEventV1_5 = function(eventId, organizerId) {
    return push1_0.createOrganizerTopicForNewEventV1_5(eventId, organizerId, exports, admin)
}

exports.sendPushToTopic = function(title, topic, msg) {
    return push1_0.sendPushToTopicV1_5(title, topic, msg, admin)
}

exports.sendPush = function(token, msg) {
    return push1_0.sendPushV1_5(token, msg, exports, admin)
}

exports.subscribeToTopic = function(token, topic) {
    return push1_0.subscribeToTopicV1_5(token, topic, admin)
}

exports.unsubscribeFromTopic = function(token, topic) {
    return push1_0.subscribeToTopicV1_5(token, topic, admin)
}

/* Resources
* Versioning: https://github.com/googleapis/nodejs-datastore/tree/master/src
* Documentation generation: https://jonathas.com/documenting-your-nodejs-api-with-apidoc/
*/