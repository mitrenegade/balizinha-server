const functions = require('firebase-functions');
const admin = require('firebase-admin');
const logging = require('@google-cloud/logging')();
const app = require('express')
const moment = require('moment')
const league1_0 = require('./league1.0')
const event1_0 = require('./event1.0')
const action1_0 = require('./action1.0')
const push1_0 = require('./push1.0')
const stripe1_0 = require('./stripe1.0')
const stripe1_1 = require('./stripe1.1')
const adminUtils1_0 = require('./adminUtils1.0')
const feedback1_0 = require('./feedback1.0')

admin.initializeApp(functions.config().firebase);

// TO TOGGLE BETWEEN DEV AND PROD: change this to .dev or .prod for functions:config variables to be correct
const config = functions.config().dev
const stripe = require('stripe')(config.stripe.token)
// 1.4 leagues
// 1.5 event.js, league.js, action.js, push.js
const API_VERSION = 1.0
const BUILD_VERSION = 111 // for internal tracking

// CONSTANT Utils //////////////////////////////////////////////////////////////////////////////////
exports.isDev = function() {
    return config.panna.environment == "dev"
}
exports.getAPIKey = function() {
    return config.firebase.api_key
}
exports.defaultLeague = function() {
    return config.panna.default_league
}

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

    // const status = "member"
    // return exports.doUpdatePlayerStatus(admin, playerId, exports.defaultLeague(), status)
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
})

// STRIPE //////////////////////////////////////////////////////////////////////////////////
// http functions
exports.ephemeralKeys = functions.https.onRequest((req, res) => {
    return stripe1_0.ephemeralKeys(req, res, stripe)
});

exports.validateStripeCustomer = functions.https.onRequest( (req, res) => {
    return stripe1_0.validateStripeCustomer(req, res, admin)
})

exports.savePaymentInfo = functions.https.onRequest( (req, res) => {
    return stripe1_0.savePaymentInfo(req, res, admin)
})

exports.refundCharge = functions.https.onRequest( (req, res) => {
    return stripe1_0.refundCharge(req, res, stripe, exports, admin)
})

exports.createStripeSubscription = functions.database.ref(`/charges/organizers/{organizerId}/{chargeId}`).onWrite((snapshot, context) => {
    return stripe1_0.createStripeSubscription(snapshot, context, stripe, exports, admin)
})

/**
 * Allows user to join a game and create a payment hold
 * params: userId: String, eventId: String
 * result: { result: success, chargeId: String, status: completed, captured: bool },  or { error: String }
 */
exports.holdPayment = functions.https.onRequest((req, res) => {
    return stripe1_1.holdPayment(req, res, stripe, exports, admin)
})

/**
 * Allows user to capture a payment. This should only be used by the admin app or have organizer validation
 * params: userId: String, eventId: String, chargeId: String
 * result: { result: success, chargeId: String, status: completed, captured: bool },  or { error: String }
 */
exports.capturePayment = functions.https.onRequest((req, res) => {
    let api = req.body.apiVersion
    if (api >= "1.1") {
        return stripe1_1.capturePayment(req, res, stripe, exports, admin)
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
        return stripe1_0.createStripeCharge(snapshot, context, stripe, exports, admin)
    } else {
        return snapshot
    }
})

// helper functions
exports.createStripeCustomer = function(email, uid) {
    return stripe1_0.createStripeCustomer(admin, stripe, email, uid)
}

// LEAGUE //////////////////////////////////////////////////////////////////////////////////
// Pass database to child functions so they have access to it


/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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

// database changes
// If the number of events gets deleted, recount the number of events. currently counting all undeleted events including past
exports.recountEvents = functions.database.ref('/leagues/{leagueId}/eventCount').onDelete((snapshot) => {
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

/**
 * params: userId: String
 * result: [ events ]
 */
exports.getEventsAvailableToUser = functions.https.onRequest((req, res) => {
    return event1_0.getEventsAvailableToUser(req, res, exports, admin)
})

// helpers
exports.createDynamicLink = function(type, id) {
    return event1_0.createDynamicLink(exports, admin, type, id)
}

// database changes
exports.onEventCreate = functions.database.ref('/events/{eventId}').onCreate((snapshot, context) => {
    return event1_0.onEventCreate(snapshot, context, exports, admin)
})

exports.onEventChange = functions.database.ref('/events/{eventId}').onWrite((snapshot, context) => {
    return event1_0.onEventChange(snapshot, context, exports, admin)
})

exports.onUserJoinOrLeaveEvent = functions.database.ref('/eventUsers/{eventId}/{userId}').onWrite((snapshot, context) => {
    return event1_0.onUserJoinOrLeaveEvent(snapshot, context, exports, admin)
})

exports.onEventDelete = functions.database.ref('/events/{eventId}').onDelete((snapshot, context) => {
    // deletion of events doesn't happen from the app
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

// database changes
exports.subscribeToOrganizerPush = functions.database.ref(`/organizers/{organizerId}`).onWrite((snapshot, context) => {
    return push1_0.subscribeToOrganizerPush(snapshot, context, exports, admin)
})

// helper functions
exports.createOrganizerTopicForNewEvent = function(eventId, organizerId) {
    return push1_0.createOrganizerTopicForNewEvent(eventId, organizerId, exports, admin)
}

exports.sendPushToTopic = function(title, topic, msg) {
    return push1_0.sendPushToTopic(title, topic, msg, admin)
}

exports.subscribeToTopic = function(token, topic) {
    return push1_0.subscribeToTopic(token, topic, admin)
}

exports.unsubscribeFromTopic = function(token, topic) {
    return push1_0.subscribeToTopic(token, topic, admin)
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

/* Resources
* Versioning: https://github.com/googleapis/nodejs-datastore/tree/master/src
* Documentation generation: https://jonathas.com/documenting-your-nodejs-api-with-apidoc/
*/