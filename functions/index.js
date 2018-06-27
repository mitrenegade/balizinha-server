const functions = require('firebase-functions');
const admin = require('firebase-admin');
const logging = require('@google-cloud/logging')();
const app = require('express')
const moment = require('moment')
const leagueModule = require('./league')
admin.initializeApp(functions.config().firebase);

// TO TOGGLE BETWEEN DEV AND PROD: change this to .dev or .prod for functions:config variables to be correct
const config = functions.config().dev
const stripe = require('stripe')(config.stripe.token)
const API_VERSION = 1.3 // leagues

const DEFAULT_LEAGUE_ID_DEV = "1525785307-821232"
const DEFAULT_LEAGUE_ID_PROD = "1525175000-268371"
const DEFAULT_LEAGUE = DEFAULT_LEAGUE_ID_DEV // change this when switching to prod

exports.onCreateUser = functions.auth.user().onCreate(user => {
    console.log("onCreateUser complete with user " + JSON.stringify(user))
    const email = user.email;
    const uid = user.uid;

    if (email == undefined) {
        console.log('anonymous customer ' + uid + ' created, not creating stripe customer. has provider data? ' + data.providerData)
        return
    }

    console.log("onCreateUser calling createPlayer with uid " + uid)
    return exports.createPlayer(uid).then(function (result) {
        console.log("onCreateUser createPlayer success with result " + result)
        return exports.createStripeCustomer(email, uid)
    })
});

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

    return exports.doJoinLeague(admin, playerId, DEFAULT_LEAGUE)
})

exports.onPlayerChange = functions.database.ref('/players/{userId}').onWrite((snapshot, context) => {
    console.log("onPlayerChange triggered with snapshot " + JSON.stringify(snapshot) + " context " + JSON.stringify(context))
    var playerId = context.params.userId
    var data = snapshot.after

    // update city
    if (data["city"] != null) {
        var city = data["city"].toLowerCase()
        var ref = `/cityPlayers/` + city
        console.log("Creating cityPlayers for city " + city + " and player " + playerId)
        var params = {[playerId]: true}
        return admin.database().ref(ref).update(params)
    }

    if (data["promotionId"] != null) {
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
        res.status(500).json({"error": "Could not validate Striper customer: empty user id"})
        return
    }
    if (email == undefined || email == "") {
        res.status(500).json({"error": "Could not validate Striper customer: empty email"})
        return
    }
    var customerRef = `/stripe_customers/${userId}/customer_id`
    return admin.database().ref(customerRef).once('value')
    .then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        if (customer != null) {
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
exports.createStripeCharge = functions.database.ref(`/charges/events/{eventId}/{id}`).onWrite(event => {
//function createStripeCharge(req, res, ref) {
    const val = event.data.val();
    const userId = val.player_id
    const eventId = event.params.eventId
    const chargeId = event.params.id
    console.log("createStripeCharge for event " + eventId + " userId " + userId + " charge id " + chargeId)
    // This onWrite will trigger whenever anything is written to the path, so
    // noop if the charge was deleted, errored out, or the Stripe API returned a result (id exists) 
    if (val === null || val.id || val.error) return null;
    // Look up the Stripe customer id written in createStripeCustomer
    return admin.database().ref(`/stripe_customers/${userId}/customer_id`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(customer => {
        // Create a charge using the pushId as the idempotency key, protecting against double charges 
        const amount = val.amount;
        const idempotency_key = chargeId;
        const currency = 'USD'
        let charge = {amount, currency, customer};
        if (val.source !== null) charge.source = val.source;
        console.log("createStripeCharge amount " + amount + " customer " + customer + " source " + val.source)
        return stripe.charges.create(charge, {idempotency_key});
    }).then(response => {
        // If the result is successful, write it back to the database
        console.log("createStripeCharge success with response " + JSON.stringify(response))
        return event.data.adminRef.update(response).then(result => {
            var type = "payForEvent"
            return exports.createAction(type, userId, eventId, null)
        })
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        console.log("createStripeCharge error " + JSON.stringify(error))
        return event.data.adminRef.child('error').set(error.message)
    })
});

exports.refundCharge = functions.https.onRequest( (req, res) => {
    const chargeId = req.body.chargeId // charge Id from balizinha
    const eventId = req.body.eventId
    const organizerId = req.body.organizerId
    const amount = req.body.amount // can be null // in cents
    var type = ""
    var typeId = ""
    if (eventId != null) {
        type = "events"
        typeId = eventId
    } else if (organizerId != null) {
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
        if (amount != null) {
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

exports.subscribeToOrganizerPush = functions.database.ref(`/organizers/{organizerId}`).onWrite(event => {
    const organizerId = event.params.organizerId
    const val = event.data.val()

    return admin.database().ref(`/players/${organizerId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var token = player["fcmToken"]
        var topic = "organizers"
        if (token && token.length > 0) {
            console.log("organizer: created " + organizerId + " subscribed to organizers")
            return exports.subscribeToTopic(token, topic)
        } else {
            console.log("subscribeToOrganizerPush: logged in with id: " + organizerId + " but no token available")
        }
    })
})

exports.createStripeSubscription = functions.database.ref(`/charges/organizers/{organizerId}/{id}`).onWrite(event => {
//function createStripeCharge(req, res, ref) {
    const val = event.data.val();
    const organizerId = event.params.organizerId
    const chargeId = event.params.id
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
        return event.data.adminRef.update(response);
    }, error => {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with Stackdriver
        const trialEnd = moment().add(trialMonths, 'months')
        const endDate = Math.floor(trialEnd.toDate().getTime()/1000) // to unix time
        console.log("createStripeSubscription error " + error.message + " trial end " + endDate)
        return event.data.adminRef.update({"error": error.message, "status": "error", "deadline": endDate})
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

// event creation/change
exports.onEventChange = functions.database.ref('/events/{eventId}').onWrite(event => {
    const eventId = event.params.eventId
    var eventChanged = false
    var eventCreated = false
    var eventDeleted = false
    var data = event.data.val();

    if (!event.data.previous.exists()) {
        eventCreated = true
    } else if (data["active"] == false) {
        eventDeleted = true
    }

    if (!eventCreated && event.data.changed()) {
        eventChanged = true;
    }

    if (eventCreated == true) {
        var title = "New event available"
        var topic = "general"
        var name = data["name"]
        var city = data["city"]
        if (!city) {
            city = data["place"]
        }

        // send push
        var msg = "A new event, " + name + ", is available in " + city
        exports.sendPushToTopic(title, topic, msg)

        // subscribe owner to event topic
        var ownerId = data["owner"]
        if (ownerId) {
            return admin.database().ref(`/players/${ownerId}`).once('value').then(snapshot => {
                return snapshot.val();
            }).then(player => {
                var token = player["fcmToken"]
                var ownerTopic = "eventOwner" + eventId
                if (token && token.length > 0) {
                    exports.subscribeToTopic(token, ownerTopic)
                    return console.log("event: " + eventId + " created " + eventCreated + " subscxribing " + ownerId + " to " + ownerTopic)
                } else {
                    return console.log("event: " + eventId + " created " + eventCreated + " user " + ownerId + " did not have fcm token")
                }
            }).then(result => {
                var type = "createEvent"
                return exports.createAction(type, ownerId, eventId, null)
            })
        } else {
            return console.log("event: " + eventId + " created " + eventCreated + " no owner id!")
        }
    } else if (eventDeleted == true) {
        var title = "Event cancelled"
        var topic = "event" + eventId
        var name = data["name"]
        var city = data["city"]
        if (!city) {
            city = data["place"]
        }

        // send push
        var msg = "An event you're going to, " + name + ", has been cancelled."
        return exports.sendPushToTopic(title, topic, msg)
    } else {
        return console.log("event: " + eventId + " created " + eventCreated + " changed " + eventChanged + " state: " + data)
    }
})

// join/leave event
exports.onUserJoinOrLeaveEvent = functions.database.ref('/eventUsers/{eventId}/{userId}').onWrite(event => {
    const eventId = event.params.eventId
    const userId = event.params.userId
    var eventUserChanged = false;
    var eventUserCreated = false;
    var eventUserData = event.data.val();

    if (!event.data.previous.exists()) {
        eventUserCreated = true;
    }
    if (!eventUserCreated && event.data.changed()) {
        eventUserChanged = true;
    }
    console.log("event: " + eventId + " user: " + userId + " state: " + eventUserData)

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var name = player["name"]
        var email = player["email"]
        var joinedString = "joined"
        if (!eventUserData) {
            joinedString = "left"
        }
        var msg = name + " has " + joinedString + " your game"
        var title = "Event update"
        var ownerTopic = "eventOwner" + eventId // join/leave message only for owners
        console.log("Sending push for user " + name + " " + email + " joined event " + ownerTopic + " with message: " + msg)

        var token = player["fcmToken"]
        var eventTopic = "event" + eventId
        if (token && token.length > 0) {
            if (eventUserData) {
                exports.subscribeToTopic(token, eventTopic)
            } else {
                exports.unsubscribeFromTopic(token, eventTopic)
            }
        }

        return exports.sendPushToTopic(title, ownerTopic, msg)
    }).then( result => { 
        var type = "joinEvent"
        if (!eventUserData) {
            type = "leaveEvent"
        }
        return exports.createAction(type, userId, eventId, null)
    })
})

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

// actions
exports.createAction = function(type, userId, eventId, message) {
    console.log("createAction type: " + type + " event id: " + eventId + " message: " + message)
    // NOTE: ref url is actions. iOS < v0.7.1 uses /action

    var actionId = exports.createUniqueId()

    var params = {}
    params["type"] = type
    params["event"] = eventId
    params["user"] = userId
    params["message"] = message
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var name = player["name"]
        params["username"] = name

        var ref = `/actions/` + actionId
        console.log("Creating action in /actions with unique id " + actionId + " message: " + message + " params: " + JSON.stringify(params))
        return admin.database().ref(ref).set(params)
        .then(result => {
            // create the same under /action
            var legacyref = `/action/` + actionId
            console.log("Duplicating action under /action with unique id " + actionId + " message: " + message + " params: " + JSON.stringify(params))
            return admin.database().ref(legacyref).set(params)
        })
    }).then(action => {
        // create eventAction
        if (eventId != null) {
            var ref = `/eventActions/` + eventId
            // when initializing a dict, use [var] notation. otherwise use params[var] = val
            var params = { [actionId] : true}
            console.log("Creating eventAction for event " + eventId + " and action " + actionId + " with params " + JSON.stringify(params))
            return admin.database().ref(ref).update(params)
        }
    })
}

exports.onActionChange = functions.database.ref('/actions/{actionId}').onWrite(event => {
    const actionId = event.params.actionId
    var changed = false
    var created = false
    var deleted = false
    var data = event.data.val();

    if (!event.data.previous.exists()) {
        created = true
    } else if (data["active"] == false) {
        deleted = true
    }

    if (!created && event.data.changed()) {
        changed = true;
    }

    const actionType = data["type"]
    if (actionType == "chat" && created == true) {
    // for a chat action, update createdAt, username then create a duplicate
        const createdAt = exports.secondsSince1970()
        const userId = data["user"]
        return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
            return snapshot.val();
        }).then(player => { 
            // add player username and createdAt
            var ref = `/actions/` + actionId
            var name = player["name"]
            console.log("Action: adding createdAt " + createdAt)
            return admin.database().ref(ref).update({"createdAt": createdAt, "username": name})
        }).then(result => {
            // create the same under /action
            // TODO: deprecate in ios 0.7.3
            var legacyref = `/action/` + actionId
            data["createdAt"] = createdAt
            console.log("Duplicating action under /action with unique id " + actionId + " message: " + data["message"])
            return admin.database().ref(legacyref).set(data)
        }).then(result => {
            // create eventAction
            var eventId = data["event"]
            var ref = `/eventActions/` + eventId
            // when initializing a dict, use [var] notation. otherwise use params[var] = val
            var params = { [actionId] : true}
            console.log("Creating eventAction for event " + eventId + " and action " + actionId + " with params " + JSON.stringify(params))
            return admin.database().ref(ref).update(params)
        }).then(result => {
            // send push
            exports.pushForChatAction(actionId, data["event"], data["user"], data)
        })
    }
});

// duplicate legacy action for chat under /actions
// TODO: deprecate this in 0.7.3
exports.onLegacyActionChange = functions.database.ref('/action/{actionId}').onWrite(event => {
    const actionId = event.params.actionId
    var changed = false
    var created = false
    var deleted = false
    var data = event.data.val();

    if (!event.data.previous.exists()) {
        created = true
    } else if (data["active"] == false) {
        deleted = true
    }

    if (!created && event.data.changed()) {
        changed = true;
    }

    const actionType = data["type"]
    if (actionType == "chat" && created == true) {
    // for a chat action, update createdAt then create a duplicate
        const userId = data["user"]
        return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
            return snapshot.val();
        }).then(player => {
            const username = player["name"]
            var ref = `/actions/` + actionId
            console.log("Duplicating legacy action under /actions with unique id " + actionId + " name " + username + " message: " + data["message"])
            data["username"] = username
            return admin.database().ref(ref).set(data).then(result =>{
                // send push
                exports.pushForChatAction(actionId, data["event"], data["user"], data)
            })
        })
    }
});

exports.pushForChatAction = function(actionId, eventId, userId, data) {
    console.log("push for chat: " + actionId + " event: " + eventId + " user: " + userId + " data: " + JSON.stringify(data))

    var eventTopic = "event" + eventId
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var name = player["name"]
        var email = player["email"]
        var message = data["message"]
        var msg = name + " said: " + message
        var title = "Event chat"
        var topic = "event" + eventId 
        console.log("Sending push for chat by user " + name + " " + email + " for chat to topic " + topic + " with message: " + msg)

        return exports.sendPushToTopic(title, topic, msg)
    })
}

// Push
exports.sendPushToTopic = function(title, topic, msg) {
        var topicString = "/topics/" + topic
        // topicString = topicString.replace(/-/g , '_');
        console.log("send push to topic " + topicString)
        var payload = {
            notification: {
                title: title,
                body: msg,
                sound: 'default',
                badge: '1'
            }
        };
        return admin.messaging().sendToTopic(topicString, payload);
}

exports.sendPush = function(token, msg) {
        //var testToken = "duvn2V1qsbk:APA91bEEy7DylD9iZctBtaKz5nS9CVZxpaAdaPwhIauzQ2jw81BF-oE0nhgvN3U10mqClTue0siwDH41JZP2kLqU0CkThOoBBdFQYWOr8X_6qHIknBE-Oa195qOy8XSbJvXeQj4wQa9T"
        
        var tokens = [token]
        console.log("send push to token " + token)
        var payload = {
            notification: {
                title: 'Firebase Notification',
                body: msg,
                sound: 'default',
                badge: "2"
            }
        };
        return admin.messaging().sendToDevice(tokens, payload);
}

exports.subscribeToTopic = function(token, topic) {
    admin.messaging().subscribeToTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Successfully subscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"]);
        })
        .catch(function(error) {
            console.log("Error subscribing to topic:", error);
        }
    );
}

exports.unsubscribeFromTopic = function(token, topic) {
    admin.messaging().unsubscribeFromTopic(token, topic)
        .then(function(response) {
        // See the MessagingTopicManagementResponse reference documentation
        // for the contents of response.
            console.log("Successfully unsubscribed " + token + " from topic: " + topic + " successful registrations: " + response["successCount"] + " failures: " + response["failureCount"]);
        })
        .catch(function(error) {
            console.log("Error unsubscribing from topic:", error);
        }
    );
}

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

// league
// Pass database to child functions so they have access to it

// http functions
exports.createLeague = functions.https.onRequest((req, res) => {
    return leagueModule.createLeague(req, res, exports, admin);
});

exports.joinLeague = functions.https.onRequest((req, res) => {
    return leagueModule.joinLeague(req, res, exports, admin)
});

exports.getPlayersForLeague = functions.https.onRequest((req, res) => {
    return leagueModule.getPlayersForLeague(req, res, exports, admin)
});

exports.getLeaguesForPlayer = functions.https.onRequest((req, res) => {
    return leagueModule.getLeaguesForPlayer(req, res, exports, admin)
});

exports.changeLeaguePlayerStatus = functions.https.onRequest((req, res) => {
    return leagueModule.changeLeaguePlayerStatus(req, res, exports, admin)
})

exports.getEventsForLeague = functions.https.onRequest((req, res) => {
    return leagueModule.getEventsForLeague(req, res, exports, admin)
});

// helper functions
exports.doJoinLeague = function(admin, userId, leagueId) {
    return leagueModule.doJoinLeague(admin, userId, leagueId)
}





