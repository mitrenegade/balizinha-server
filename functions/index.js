const functions = require('firebase-functions');
const logging = require('@google-cloud/logging');
const admin = require('firebase-admin');
const app = require('express')
const moment = require('moment')
const league1_0 = require('./league1.0')
const league1_1 = require('./league1.1')
const league2_0 = require('./league2.0')
const event1_0 = require('./event1.0')
const event1_1 = require('./event1.1')
const event2_0 = require('./event2.0')
const action1_0 = require('./action1.0')
const push1_0 = require('./push1.0')
const push1_1 = require('./push1.1')
const stripe1_0 = require('./stripe1.0')
const stripe1_1 = require('./stripe1.1')
const stripe1_2 = require('./stripe1.2')
const adminUtils1_0 = require('./adminUtils1.0')
const feedback1_0 = require('./feedback1.0')
const share1_0 = require('./share1.0')
const feed1_0 = require('./feed1.0')
const stripeConnect1_0 = require('./stripeConnect1.0')
const promotion1_0 = require('./promotion1.0')
const globals = require('./globals')
const venue1_0 = require('./venue1.0')

admin.initializeApp(functions.config().firebase);

exports.serverInfo = functions.https.onRequest((req, res) => {
    var environment = "production"
    if (globals.isDev == true) {
        environment = "development"
    }
    return res.status(200).json({"version": globals.apiVersion, "build": globals.buildVersion, "environment": environment})
});

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
        return stripeConnect1_0.createStripeCustomer(email, userId)
    })
}

exports.createPlayerForAnonymousUser = functions.https.onRequest( (req, res) => {
    const userId = req.body.userId
    const name = req.body.name
    if (userId == undefined) {
        return res.status(500).json({"error": "Invalid user id"})
    }
    return admin.database().ref(`players/${userId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            const player = snapshot.val()
            return res.status(200).json({"success": false, "message": "Player already exists", "userId": userId})
        } else {
            return exports.createPlayer(userId, name).then(() => {
                res.status(200).json({"success": true, "userId": userId})
            })
        }
    })
})

// TODO actually implement this in client
exports.onEmailSignupV1_5 = functions.https.onRequest((req, res) => {
    // in v1_5, when a player is created, their email is added to the anonymous account already created.
    // this causes onCreateUser to not be triggere a second time, thus createPlayer and createStripeCustomer are not called
    // the client accessing v1_4 must call onEmailSignupV1_4 to trigger player and customer creation in order to continue signup
    const userId = req.body.userId
    const email = req.body.email
    console.log("onEmailSignup v1.5: client call to create email user " + userId + " with email " + email)
    exports.doEmailSignup(userId, email)
})

exports.createPlayer = function(userId, name) {
    var ref = `/players/${userId}`
    console.log("Creating player for user " + userId)
    var params = {"uid": userId}
    params["createdAt"] = exports.secondsSince1970()
    if (name != undefined) {
        params["name"] = name
    }
    return admin.database().ref(ref).update(params)
}

// event creation/change
exports.onPlayerCreate = functions.database.ref('/players/{userId}').onCreate((snapshot, context) => {
    return snapshot
//     console.log("onPlayerCreate triggered with snapshot " + JSON.stringify(snapshot) + " context " + JSON.stringify(context))
//     var playerId = context.params.userId
//     var email = snapshot.email // snapshot only contains email

})

exports.onPlayerChange = functions.database.ref('/players/{userId}').onWrite((snapshot, context) => {
    var playerId = context.params.userId
    var data = snapshot.after.val()
    var old = snapshot.before.val()

    // update city
    if (data["cityId"] != undefined && data["cityId"] != old["cityId"]) {
        var cityId = data["cityId"]
        var ref = `/cityPlayers/` + cityId
        var params = {[playerId]: true}
        return admin.database().ref(ref).update(params).then(() => {
            var oldCityId = old["cityId"]
            if (oldCityId != undefined) {
                console.log("onPlayerChange: city updated from id " + oldCityId + " to " + cityId)
                var params = {[playerId]: false}
                return admin.database().ref(`/cityPlayers/${oldCityId}`).update(params)
            }
            console.log(`onPlayerChange: player ${userId} city updated to id ${cityId}`)
        })
    }

    if (data["promotionId"] != undefined && data["promoId"] != old["promoId"]) {
        var promo = data["promotionId"].toLowerCase()
        var ref = `/promoPlayers/` + promo
        console.log("Creating promoPlayers for promo " + promo + " and player " + playerId)
        var params = {[playerId]: true}
        return admin.database().ref(ref).update(params)
    }

    return data
})

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
    return globals.secondsSince1970()
}

exports.createUniqueId = function() {
    return globals.createUniqueId()
}

exports.getUniqueId = functions.https.onRequest( (req, res) => {
    var uniqueId = globals.createUniqueId()
    console.log('Called getUniqueId with result ' + uniqueId)
    res.status(200).json({"id": uniqueId})
})

// TEST calling cloud function from client
exports.sampleCloudFunction = functions.https.onRequest((req, res) => {
    const uid = req.body.uid
    const email = req.body.email

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
})

// STRIPE //////////////////////////////////////////////////////////////////////////////////
// http functions
exports.ephemeralKeys = functions.https.onRequest((req, res) => {
    return stripe1_0.ephemeralKeys(req, res)
});

exports.validateStripeCustomer = functions.https.onRequest( (req, res) => {
    return stripeConnect1_0.validateStripeCustomer(req, res)
})

exports.savePaymentInfo = functions.https.onRequest( (req, res) => {
    return stripeConnect1_0.savePaymentInfo(req, res)
})

exports.refundCharge = functions.https.onRequest( (req, res) => {
    return stripe1_0.refundCharge(req, res)
})

/**
 * Creates a subscription. <<>>
 * params: type: [owner, membershp]
 *         leagueId: String
 *         userId: String
 * Result: { subscription object including stripeInfo }
 */
exports.createSubscription = functions.https.onRequest( (req, res) => {
    return stripe1_2.createSubscription(req, res, exports)
})

/**
 * loads all subscriptions from /subscriptions for current user
 * params: userId: String
 * result: [ subscriptions ]
 */
exports.getSubscriptions = functions.https.onRequest( (req, res) => {
    return stripe1_2.getSubscriptions(req, res)
})

/**
 * Allows user to join a game and create a payment hold
 * params: userId: String, eventId: String
 * result: { result: success, chargeId: String, status: completed, captured: bool },  or { error: String }
 */
exports.holdPayment = functions.https.onRequest((req, res) => {
    // iOS 1.1.1 and Android 1.0.6 and below still call "holdPayment" from client side
    // as of API 125, makePayment is a more generic payment call that will decide whether to use platform charges or connect
    return stripe1_1.makePayment(req, res, exports)
})

/**
 * Allows user to and create a payment by making a connect charge or holding a payment, depending on the event's organizer
 * params: userId: String, eventId: String
 * result: { result: success, chargeId: String, status: completed },  or {result: error}
 */
exports.makePayment = functions.https.onRequest((req, res) => {
    // iOS 1.1.1 and Android 1.0.6 and below still call "holdPayment" from client side
    // as of API 125, makePayment is a more generic payment call that will decide whether to use platform charges or connect
    return stripe1_1.makePayment(req, res, exports)
})
/**
 * Allows user to capture a payment. This should only be used by the admin app or have organizer validation
 * params: userId: String, eventId: String, chargeId: String
 * result: { result: success, chargeId: String, status: completed, captured: bool },  or { error: String }
 */
exports.capturePayment = functions.https.onRequest((req, res) => {
    let api = req.body.apiVersion
    if (api >= "1.1") {
        return stripe1_1.capturePayment(req, res, exports, admin)
    } else {
        console.log("api: " + api + ">1.1 ? " + api >= "1.1")
        return res.status(500).json({"error": "Unknown api version"})
    }
})

// database listeners
exports.onCreateCharge = functions.database.ref(`/charges/events/{eventId}/{chargeId}`).onCreate((snapshot, context) => {
    console.log("onCreateCharge: snapshot => " + JSON.stringify(snapshot))
    const val = snapshot.val()
    if (val["id"] == undefined) {
        console.log("onCreateCharge: charge initiated by client app; need to create stripe charge")
        return stripe1_0.createStripeCharge(snapshot, context, exports, admin)
    } else {
        return snapshot
    }
})

// STRIPE CONNECT //////////////////////////////////////////////////////////////////////////////////
exports.stripeConnectRedirectHandler = functions.https.onRequest((req, res) => {
    return stripeConnect1_0.stripeConnectRedirectHandler(req, res, exports)
})

exports.getConnectAccountInfo = functions.https.onRequest((req, res) => {
    return stripeConnect1_0.getConnectAccountInfo(req, res, exports)
})

exports.createStripeConnectCharge = functions.https.onRequest((req, res) => {
    return stripeConnect1_0.createStripeConnectCharge(req, res, exports)
})


// LEAGUE //////////////////////////////////////////////////////////////////////////////////
// Pass database to child functions so they have access to it

// http functions
exports.createLeague = functions.https.onRequest((req, res) => {
    return league2_0.createLeague(req, res, exports, admin);
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

/**
 * params: leagueId: String
 * result: [ { players: Int, events: Int }]
 */
exports.getLeagueStats = functions.https.onRequest((req, res) => {
    return league1_0.getLeagueStats(req, res, exports, admin)
})

// get leagues and subscription objects for ownership
/*
 * params: userId
 * results: {leagues: [League], subscriptions: [Subscription]}
 */
exports.getOwnerLeaguesAndSubscriptions = functions.https.onRequest((req, res) => {
    return league1_1.getOwnerLeaguesAndSubscriptions(req, res)
})

/*
 * params: userId
 * results: {leagues: [League]}
 */
exports.getLeaguesOwnedByUser = functions.https.onRequest((req, res) => {
    return league1_1.getLeaguesOwnedByUser(req, res)
})

// database changes
exports.onLeagueCreate = functions.database.ref('/leagues/{leagueId}').onCreate((snapshot, context) => {
    return league1_0.onLeagueCreate(snapshot, context, exports, admin)
})

// If the number of events gets deleted, recount the number of events. currently counting all undeleted events including past
exports.recountEvents = functions.database.ref('/leagues/{leagueId}/eventCount').onDelete((snapshot) => {
    // only recount events if league was not deleted
    return event1_0.recountEvents(snapshot, admin)
});

// If the number of players gets deleted, recount the number of active players
exports.recountPlayers = functions.database.ref('/leagues/{leagueId}/playerCount').onDelete((snapshot) => {
    return league1_0.recountPlayers(snapshot, admin)
});

// helper functions
exports.doUpdatePlayerStatus = function(admin, userId, leagueId, status) {
    return league1_0.doUpdatePlayerStatus(admin, userId, leagueId, status)
}

// EVENT //////////////////////////////////////////////////////////////////////////////////
/**
 * params: 
 ** required: userId: String
 **           startTime, endTime: Int (seconds from 1970)
 **           
 ** Either: venueId: String (loaded from venues)
 ** Or: city, state, place, lat, lon
 **
 ** optional: 
 **           league, name, type, info: String
 **           maxPlayers: Int
 **           paymentRequired: Bool
 **           amount: Double
 **           recurrence: none, daily, weekly, monthly
 **           recurrenceEndDate: Int (seconds from 1970) - the timestamp of the event end time on the last day
 **
 * result: [ { eventId: String } ]
 *** for a recurrence event, the eventId is the original event
 */
exports.createEvent = functions.https.onRequest((req, res) => {
    return event2_0.createEvent(req, res, exports)
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

/**
 * This function returns a dictionary of eventId:eventDict where the eventDict is the full event data
 * This function handles finding events that belong to the user (in private leagues)
 * params: userId: String
 * result: [ results: {eventId: {eventDict}} ]
 */
exports.getEventsAvailableToUser = functions.https.onRequest((req, res) => {
    return event1_0.getEventsAvailableToUser(req, res, exports, admin)
})

/**
 * params: eventId: String
 *         isCancelled: Bool
 * result: [ success: true ]
 */
exports.cancelEvent = functions.https.onRequest((req, res) => {
    return event1_1.cancelEvent(req, res, exports)
})

/**
 * params: eventId: String
 * result: [ success: true ]
 */
exports.deleteEvent = functions.https.onRequest((req, res) => {
    return event1_1.deleteEvent(req, res)
})

/**
 * params: eventId: String
 *         userId: String
 * result: { paymentRequired: bool, amount: Double? }
 */
exports.shouldChargeForEvent = functions.https.onRequest((req, res) => {
    return event1_1.shouldChargeForEvent(req, res) // exports needed for promo helpers
})

// database changes
exports.onEventCreate = functions.database.ref('/events/{eventId}').onCreate((snapshot, context) => {
    return event1_0.onEventCreate(snapshot, context, exports)
})

exports.onUserJoinOrLeaveEvent = functions.database.ref('/eventUsers/{eventId}/{userId}').onWrite((snapshot, context) => {
    return event1_0.onUserJoinOrLeaveEvent(snapshot, context, exports, admin)
})

// helpers - must be defined here in order to use in module
exports.doJoinOrLeaveEvent = function(userId, eventId, join, admin) {
    return event1_0.doJoinOrLeaveEvent(userId, eventId, join, admin)
}

exports.pushForCreateEvent = function(eventId, leagueId, name, place) {
    return push1_0.pushForCreateEvent(eventId, leagueId, name, place, exports, admin)
}

exports.pushForJoinEvent = function(eventId, name, join) {
    return push1_0.pushForJoinEvent(eventId, name, join, exports, admin)
}

// ACTION //////////////////////////////////////////////////////////////////////////////////
/**
 * params:
 *  userId: String
 *  eventId: String
 *  message: String
 * result: { actionId: String }
*/

exports.postChat = functions.https.onRequest((req, res) => {
    return action1_0.postChat(req, res, exports, admin)
})

exports.createAction = function(type, userId, eventId, message, defaultMessage) {
    return action1_0.createAction(type, userId, eventId, message, defaultMessage, exports, admin)
}

exports.onActionChange = functions.database.ref('/actions/{actionId}').onWrite((snapshot, context) => {
    return action1_0.onActionChange(snapshot, context, exports, admin)
})

exports.pushForChatAction = function(actionId, eventId, userId, data) {
    return action1_0.pushForChatAction(actionId, eventId, userId, data, exports, admin)
}

// PUSH //////////////////////////////////////////////////////////////////////////////////

// iOS 1.1.1 and below
exports.refreshPlayerSubscriptions = functions.https.onRequest((req, res) => {
    return push1_0.refreshPlayerSubscriptions(req, res, exports, admin)
})

exports.refreshPlayerSubscriptionsHelper = function(userId, token, pushEnabled) {
    return push1_0.refreshPlayerSubscriptionsHelper(userId, token, pushEnabled)
}

// iOS 1.1.2 and above
// Android 1.0.9 and above?
/*
 * userId: String
 * pushEnabled: Bool
 * returns: {success: true, subscribed: Int, unsubscribed: Int}
 * Will return a count of subscribed channels or unsubscribed channels
 * will also return an error message if failure
 */
exports.updateUserNotificationsEnabled = functions.https.onRequest((req, res) => {
    return push1_1.updateUserNotificationsEnabled(req, res, exports)
})

// database changes
exports.subscribeToOrganizerPush = functions.database.ref(`/organizers/{organizerId}`).onWrite((snapshot, context) => {
    return push1_0.subscribeToOrganizerPush(snapshot, context, exports, admin)
})

// helper functions
exports.createOrganizerTopicForNewEvent = function(eventId, organizerId) {
    return push1_0.createOrganizerTopicForNewEvent(eventId, organizerId, exports, admin)
}

exports.sendPushToTopic = function(title, topic, msg, info) {
    return push1_1.sendPushToTopic(title, topic, msg, info)
}

exports.subscribeToEvent = function(eventId, userId, join) {
    return push1_0.subscribeToEvent(eventId, userId, join, exports, admin)
}

exports.subscribeToLeague = function(leagueId, userId, isSubscribe) {
    return push1_0.subscribeToLeague(leagueId, userId, isSubscribe, exports, admin)
}

exports.pushForLeagueFeedItem = function(leagueId, type, userId, message) {
    return push1_0.pushForLeagueFeedItem(leagueId, type, userId, message, exports, admin)
}

// test
exports.sendPush = function(token, msg) {
    return push1_0.sendPush(token, msg, exports, admin)
}

// Feedback //////////////////////////////////////////////////////////////////////////////////
/**
 * params: userId: String, subject: String, details: String, email: String
 * result: [ result: feedback ]
 */
exports.submitFeedback = functions.https.onRequest((req, res) => {
    return feedback1_0.submitFeedback(req, res, exports, admin)
})

// Share //////////////////////////////////////////////////////////////////////////////////
/**
 * params: type: String = "leagues", "events"
 * id: String
 * result: [  ]
 */
exports.createDynamicLink = function(type, id, metadata) {
    return share1_0.createDynamicLink(exports, admin, type, id, metadata)
}

// FEED //////////////////////////////////////////////////////////////////////////////////
/**
 * params: 
 * type: String = ["chat", "photo"]
 * feedItemId: String
 * userId, leagueId: String (Required)
 * message: String (optional)
 */
exports.createFeedItem = functions.https.onRequest((req, res) => {
    return feed1_0.createFeedItem(req, res, exports, admin)
})

exports.createFeedItemForEventAction = function(type, userId, actionId, message, defaultMessage) {
    return feed1_0.createFeedItemForEventAction(type, userId, actionId, message, defaultMessage, exports, admin)
}

exports.createFeedItemForJoinLeaveLeague = function(userId, leagueId, isJoin) {
    return feed1_0.createFeedItemForJoinLeaveLeague(userId, leagueId, isJoin, exports, admin) 
}

// // PROMOTIONS //////////////////////////////////////////////////////////////////////////////////

// // helper
 /**
 * params: promoId: String
 * result: promotion JSON or undefined
 */
exports.promotionWithId = functions.https.onRequest((req, res) => {
    return promotion1_0.promotionWithId(req, res)
})

// /**
//  * params: promotion: JSON representing a promotion object
//  * result: bool whether promo is valid and active
//  */
// exports.isValidPromotionCode = function(promotion) {
//     return promotion1_0.isValidPromotionCode(promotion)
// }

// VENUES - venues and cities //////////////////////////////////////////////////////////////////////////////////

/**
 * params: none
 * result: [ venues ]
 */
exports.getVenues = functions.https.onRequest((req, res) => {
    return venue1_0.getVenues(req, res)
})

/**
 * params: 
 *
 * Required:
 *  userId: String
 *  name: String (venue name)
 *  street, city, state: String
 *  lat, lon: Double
 *
 * Optional:
 *  placeId: Google place Id, Apple Place Id, or other.
 *  type: String

 Types for venue:
        case grass
        case turf
        case wood
        case concrete
        case mats
        case rubber
        case other
        case unknown

 * result: [ success: true, venueId: String ]
 */


exports.createVenue = functions.https.onRequest((req, res) => {
    return venue1_0.createVenue(req, res, exports)
})

/**
 * params: none
 * result: [ cities ]
 */
exports.getCities = functions.https.onRequest((req, res) => {
    return venue1_0.getCities(req, res)
})

/**
 * params: name, state: String
 *         lat, lon: Double
 * result: [ cityId: String, city: { city } ]
 */
exports.createCity = functions.https.onRequest((req, res) => {
    return venue1_0.createCity(req, res)
})

exports.deleteCity = functions.https.onRequest((req, res) => {
    return venue1_0.deleteCity(req, res)
})

// UTILS - used by Admin app //////////////////////////////////////////////////////////////////////////////////
/**
 * params: userId: String
 * result: [ events ]
 */
exports.updateEventLeagueIsPrivate = functions.https.onRequest((req, res) => {
    return adminUtils1_0.updateEventLeagueIsPrivate(req, res, exports, admin)
})

exports.recountLeagueStats = functions.https.onRequest((req, res) => {
    return adminUtils1_0.recountLeagueStats(req, res, exports, admin)
})

/**
 * result: [uid: "exists" or "deleted" = true, userInfo ]
 */
const runtimeOpts = {
    // https://firebase.google.com/docs/functions/manage-functions
    timeoutSeconds: 120
}
exports.cleanupAnonymousAuth = functions.runWith(runtimeOpts).https.onRequest((req, res) => {
    return adminUtils1_0.cleanupAnonymousAuth(req, res, exports, admin)
})

/**
 * params: type = [events, leagues], id = string
 * result: {shortLink: url}
 */
exports.generateShareLink = functions.https.onRequest((req, res) => {
    return adminUtils1_0.generateShareLink(req, res, exports, admin)
})

/**
 * params: userId, topic: String
 * enabled: Bool
 * result: {success}
 *
 * Enables subscriptions for a single user by adding all leagues and events to /playerTopics
 */
exports.refreshAllPlayerTopics = functions.https.onRequest((req, res) => {
    return push1_0.refreshAllPlayerTopics(req, res, exports, admin)
})

/**
 * migrates stripe_customers data to stripeCustomers endpoint
 * result: {success, count of stripeCustomers, count of stripe_customers}
 */
exports.migrateStripeCustomers = functions.https.onRequest((req, res) => {
    return adminUtils1_0.migrateStripeCustomers(req, res)
})

/**
 * Takes current league/id/ownerId and adds it to /leagueOwners/id
 * result: {result}
 */
exports.migrateLeagueOwnerIdToLeagueOwnersArray = functions.https.onRequest((req, res) => {
    return adminUtils1_0.migrateLeagueOwnerIdToLeagueOwnersArray(req, res)
})
/* Resources
* Versioning: https://github.com/googleapis/nodejs-datastore/tree/master/src
* Documentation generation: https://jonathas.com/documenting-your-nodejs-api-with-apidoc/
*/